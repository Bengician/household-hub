import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';

import { supabase } from '../../../lib/supabase';

type Category =
  | 'groceries'
  | 'hardware_home'
  | 'storage_log'
  | 'action_items'
  | 'messages'
  | 'random_notes';
type CaptureAction = 'add' | 'cross_off';
type Intent = 'MUTATION' | 'QUERY';

type CaptureResult = {
  action: CaptureAction;
  item_name: string;
  category: Category;
  description?: string;
};

type MutationResult = {
  items: CaptureResult[];
};

type IntentResult = {
  intent: Intent;
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
            enum: ['add', 'cross_off'],
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
              'messages',
              'random_notes',
            ],
          },
          description: { type: Type.STRING },
        },
      },
    },
  },
};

const intentSchema = {
  type: Type.OBJECT,
  required: ['intent'],
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['MUTATION', 'QUERY'],
    },
  },
};

const retryDelays = [500, 1000, 2000];

async function generateWithRetry(
  ai: GoogleGenAI,
  contents: string,
  config?: Parameters<typeof ai.models.generateContent>[0]['config'],
) {
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    try {
      return await ai.models.generateContent({
        model: 'gemini-3.6-flash',
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
    const intentResponse = await generateWithRetry(
      ai,
      `Classify the intent of this household input as exactly one of MUTATION or QUERY.

MUTATION means the user wants to add, remove, buy, finish, or complete an item or task.
QUERY means the user is asking for information about items currently on the household whiteboard.

Household input:
${body.rawInput}`,
      {
        responseMimeType: 'application/json',
        responseSchema: intentSchema,
      },
    );
    const intentData = JSON.parse(intentResponse.text ?? '') as IntentResult;

    if (intentData.intent === 'QUERY') {
      const { data: whiteboardItems, error } = await supabase
        .from('whiteboard_items')
        .select('item_name, category, description, is_completed')
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      const queryResponse = await generateWithRetry(
        ai,
        `Answer the household user's question briefly and naturally using only the current whiteboard data below. If the answer is not present, say that you could not find it on the whiteboard.

User question:
${body.rawInput}

Current whiteboard data:
${JSON.stringify(whiteboardItems ?? [])}`,
      );

      return NextResponse.json({
        type: 'query',
        answer: queryResponse.text?.trim() ?? '',
      });
    }

    const response = await generateWithRetry(
      ai,
      `Classify this household input: ${body.rawInput}

Return action \`add\` for a new item or \`cross_off\` if the user says they bought, finished, or completed something.

Choose exactly one category:
- groceries: food, drinks, and household consumables to buy
- hardware_home: tools, repairs, maintenance, and home improvement
- storage_log: items put away, stored, or worth remembering where they are
- action_items: tasks, errands, and reminders
- messages: notes intended for another household member
- random_notes: anything that does not fit the other categories

If the user lists multiple distinct physical items or separate tasks (e.g., in a grocery list), break them apart and return each item as a completely separate object in the \`items\` array. However, do not split up single, unified thoughts or messages that just happen to contain the word 'and' (e.g., keep "Beth and Sue called" as a single item).`,
      {
        responseMimeType: 'application/json',
        responseSchema,
      },
    );

    const extractedData = JSON.parse(response.text ?? '') as MutationResult;

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

    const targetResults = await Promise.all(
      extractedData.items.map((item) =>
        item.action === 'add'
          ? supabase.from('whiteboard_items').insert({
              item_name: item.item_name,
              category: item.category,
              description: item.description,
            })
          : supabase
              .from('whiteboard_items')
              .update({ is_completed: true })
              .ilike('item_name', `%${item.item_name}%`),
      ),
    );

    const targetError = targetResults.find((result) => result.error)?.error;
    if (targetError) {
      throw targetError;
    }

    return NextResponse.json({ type: 'mutation', items: extractedData.items });
  } catch (error) {
    console.error('Capture request failed:', error);
    return NextResponse.json(
      { error: 'Unable to process capture request' },
      { status: 500 },
    );
  }
}
