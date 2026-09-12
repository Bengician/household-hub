import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

type Category = 'groceries' | 'hardware_home' | 'storage_log' | 'action_items';
type CaptureAction = 'add' | 'remove' | 'extract';

type CaptureResult = {
  action: CaptureAction;
  item_name: string;
  category: Category;
  location?: string;
};

type MutationResult = {
  items: CaptureResult[];
};

const responseSchema = {
  type: Type.OBJECT,
  required: ['items'],
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['action', 'item_name', 'category'],
        properties: {
          action: {
            type: Type.STRING,
            enum: ['add', 'remove', 'extract'],
          },
          item_name: {
            type: Type.STRING,
          },
          category: {
            type: Type.STRING,
            enum: [
              'groceries',
              'hardware_home',
              'storage_log',
              'action_items',
            ],
          },
          location: {
            type: Type.STRING,
            description: "Only used for the storage_log category when adding an item.",
          },
        },
      },
    },
  },
};

const systemInstruction = `You are the intent parsing engine for a household whiteboard app. 
Parse voice transcripts into a strict JSON object containing an 'items' array.

ACTIONS:
- add: The user wants to add a new item to the board, store an item, or create a new task.
- remove: The user bought an item, finished a task, or wants an item crossed off.
- extract: The user is asking a question, wants to see a list, or is looking for an item.

CATEGORIES:
- groceries: Food and consumables to buy.
- hardware_home: Hardware, garden, or home supplies to buy.
- storage_log: Where physical household items have been placed or stored.
- action_items: Tasks, chores, or services to hire around the house.

FEW-SHOT EXAMPLES:
Input: "We need to buy tomatoes"
Output: {"items": [{"action": "add", "category": "groceries", "item_name": "tomatoes"}]}

Input: "Cross off the milk"
Output: {"items": [{"action": "remove", "category": "groceries", "item_name": "milk"}]}

Input: "Make a grocery list"
Output: {"items": [{"action": "extract", "category": "groceries", "item_name": "all"}]}

Input: "I put the spare keys in the garage"
Output: {"items": [{"action": "add", "category": "storage_log", "item_name": "spare keys", "location": "garage"}]}

Input: "Where are the keys?"
Output: {"items": [{"action": "extract", "category": "storage_log", "item_name": "keys"}]}

Input: "We need to fix the roof"
Output: {"items": [{"action": "add", "category": "action_items", "item_name": "fix the roof"}]}

Input: "What do we need to do around the house?"
Output: {"items": [{"action": "extract", "category": "action_items", "item_name": "all"}]}`;

const retryDelays = [500, 1000, 2000];

async function generateWithRetry(
  ai: GoogleGenAI,
  contents: string,
  config?: Parameters<typeof ai.models.generateContent>[0]['config'],
) {
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    try {
      return await ai.models.generateContent({
        model: 'gemini-3.5-flash', // Upgraded to 3.5-flash for perfect intent accuracy
        contents,
        config,
      });
    } catch (error) {
      if (attempt === retryDelays.length - 1) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelays[attempt]),
      );
    }
  }
  throw new Error('Gemini did not return a response');
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rawInput?: unknown };

    if (typeof body.rawInput !== 'string') {
      return NextResponse.json(
        { error: 'rawInput must be a string' },
        { status: 400 },
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Step 1: Single LLM call to parse intents using the new system instructions
    const response = await generateWithRetry(
      ai,
      body.rawInput,
      {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1, // Keeps the model strictly focused on categorization
      },
    );

    const extractedData = JSON.parse(response.text ?? '') as MutationResult;

    // Save to activity log
    const activityResults = await Promise.all(
      extractedData.items.map((item) =>
        supabase.from('household_activity').insert({
          raw_input: body.rawInput,
          action: item.action,
          category: item.category,
        }),
      ),
    );

    const activityError = activityResults.find((result) => result.error)?.error;
    if (activityError) {
      throw activityError;
    }

    // Step 2: Route the actions
    const extractItems = extractedData.items.filter((i) => i.action === 'extract');
    const mutationItems = extractedData.items.filter((i) => i.action !== 'extract');

    // Handle EXTRACT (Voice Queries)
    if (extractItems.length > 0) {
      let contextData = [];

      for (const item of extractItems) {
        if (item.category === 'storage_log') {
          // THE FIX: Order by newest first, and strictly limit to 4 results
          const { data } = await supabase
            .from('whiteboard_items')
            .select('item_name, description, created_at')
            .eq('category', 'storage_log')
            .ilike('item_name', `%${item.item_name}%`)
            .order('created_at', { ascending: false })
            .limit(4);

          if (data) contextData.push(...data);
        } else {
          // General lists for other categories: Get all active items
          const { data } = await supabase
            .from('whiteboard_items')
            .select('item_name, category')
            .eq('category', item.category)
            .eq('is_completed', false);

          if (data) contextData.push(...data);
        }
      }

      // Ask Gemini to format the targeted Supabase data naturally
      const queryResponse = await generateWithRetry(
        ai,
        `Answer the household user's question briefly and naturally using only the context data below.
         If the question is about where an item is stored, state the most recent location, and then optionally list up to 3 previous locations if they exist in the context data.
         If the answer is not present, say that you could not find it on the whiteboard.

        User question: ${body.rawInput}

        Context data:
        ${JSON.stringify(contextData)}`,
      );

      return NextResponse.json({
        type: 'query',
        answer: queryResponse.text?.trim() ?? '',
      });
    }

    // Handle ADD and REMOVE mutations
    if (mutationItems.length > 0) {
      const targetResults = await Promise.all(
        mutationItems.map((item) =>
          item.action === 'add'
            ? supabase.from('whiteboard_items').insert({
                item_name: item.item_name,
                category: item.category,
                description: item.location, // Maps the specific storage location to the description column
              })
            : supabase
                .from('whiteboard_items')
                .update({ is_completed: true })
                .ilike('item_name', `%${item.item_name}%`)
                .eq('category', item.category),
        ),
      );

      const targetError = targetResults.find((result) => result.error)?.error;
      if (targetError) {
        throw targetError;
      }
    }

    return NextResponse.json({ type: 'mutation', items: mutationItems });
  } catch (error) {
    console.error('Capture request failed:', error);
    return NextResponse.json(
      { error: 'Unable to process capture request' },
      { status: 500 },
    );
  }
}