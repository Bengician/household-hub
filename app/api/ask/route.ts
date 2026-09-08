import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { supabase } from '../../../lib/supabase';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: unknown };

    if (typeof body.question !== 'string') {
      return NextResponse.json(
        { error: 'question must be a string' },
        { status: 400 },
      );
    }

    const [groceryResult, storedResult] = await Promise.all([
      supabase
        .from('grocery_items')
        .select('*')
        .eq('is_purchased', false),
      supabase.from('stored_items').select('*'),
    ]);

    if (groceryResult.error || storedResult.error) {
      throw groceryResult.error ?? storedResult.error;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: `You are a helpful household assistant. Answer the user's question concisely and strictly based on the provided JSON data. Do not invent, infer, or use information that is not present in the JSON data.

User question:
${body.question}

Grocery items JSON:
${JSON.stringify(groceryResult.data ?? [])}

Stored items JSON:
${JSON.stringify(storedResult.data ?? [])}`,
    });

    return NextResponse.json({ answer: response.text ?? '' });
  } catch (error) {
    console.error('Ask request failed:', error);
    return NextResponse.json(
      { error: 'Unable to answer the question' },
      { status: 500 },
    );
  }
}
