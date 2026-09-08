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

type CaptureResult = {
  action: CaptureAction;
  item_name: string;
  category: Category;
  description?: string;
};

const responseSchema = {
  type: Type.OBJECT,
  maxProperties: 4,
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
};

const retryDelays = [500, 1000, 2000];

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
    let response;
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: `Classify this household input: ${body.rawInput}

Return action \`add\` for a new item or task, and \`cross_off\` if the user says they bought, finished, or completed something.

Choose exactly one category:
- groceries: food, drinks, and household consumables to buy
- hardware_home: tools, repairs, maintenance, and home improvement
- storage_log: items put away, stored, or worth remembering where they are
- action_items: tasks, errands, and reminders
- messages: notes intended for another household member
- random_notes: anything that does not fit the other categories`,
          config: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        });
        break;
      } catch (error) {
        if (attempt === retryDelays.length - 1) {
          throw error;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, retryDelays[attempt]),
        );
      }
    }

    if (!response) {
      throw new Error('Gemini did not return a response');
    }

    const extractedData = JSON.parse(response.text ?? '') as CaptureResult;

    const { error: activityError } = await supabase
      .from('household_activity')
      .insert({
        raw_input: body.rawInput,
        action: extractedData.action,
        category: extractedData.category,
      });

    if (activityError) {
      throw activityError;
    }

    const targetResult =
      extractedData.action === 'add'
        ? await supabase.from('whiteboard_items').insert({
            item_name: extractedData.item_name,
            category: extractedData.category,
            description: extractedData.description,
          })
        : await supabase
            .from('whiteboard_items')
            .update({ is_completed: true })
            .ilike('item_name', `%${extractedData.item_name}%`);

    if (targetResult.error) {
      throw targetResult.error;
    }

    return NextResponse.json(extractedData);
  } catch (error) {
    console.error('Capture request failed:', error);
    return NextResponse.json(
      { error: 'Unable to process capture request' },
      { status: 500 },
    );
  }
}
