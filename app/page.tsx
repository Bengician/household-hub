"use client";

import { Caveat } from "next/font/google";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { supabase } from "../lib/supabase";

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

type Category =
  | "groceries"
  | "hardware_home"
  | "storage_log"
  | "action_items"
  | "messages"
  | "random_notes";

type WhiteboardItem = {
  id: string;
  item_name: string;
  category: Category;
  description: string | null;
};

type SpeechRecognitionEvent = Event & {
  results: { [index: number]: { [index: number]: { transcript: string } } };
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const zones: { category: Category; label: string; tint: string }[] = [
  { category: "groceries", label: "Groceries", tint: "bg-amber-50/80" },
  {
    category: "hardware_home",
    label: "Hardware & Home",
    tint: "bg-sky-50/80",
  },
  { category: "storage_log", label: "Storage Log", tint: "bg-emerald-50/80" },
  { category: "action_items", label: "Action Items", tint: "bg-rose-50/80" },
  { category: "messages", label: "Messages", tint: "bg-violet-50/80" },
  { category: "random_notes", label: "Random Notes", tint: "bg-orange-50/80" },
];

export default function Home() {
  const [rawInput, setRawInput] = useState("");
  const [items, setItems] = useState<WhiteboardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [queryResponse, setQueryResponse] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);

    const { data, error } = await supabase
      .from("whiteboard_items")
      .select("id, item_name, category, description")
      .eq("is_completed", false)
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMessage("The whiteboard could not be loaded.");
    } else {
      setItems((data ?? []) as WhiteboardItem[]);
      setErrorMessage(null);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadItems(), 0);

    return () => window.clearTimeout(loadTimer);
  }, [loadItems]);

  const captureInput = useCallback(async (input: string) => {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      setErrorMessage("Write something for the house to remember.");
      return;
    }

    setIsCapturing(true);
    setErrorMessage(null);
    setIsFlipped(false);

    try {
      const response = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: trimmedInput }),
      });

      if (!response.ok) {
        throw new Error("Capture request failed");
      }

      const responseData = (await response.json()) as {
        type?: unknown;
        answer?: unknown;
      };

      setRawInput("");
      if (responseData.type === "query" && typeof responseData.answer === "string") {
        setQueryResponse(responseData.answer);
        setIsFlipped(true);
      } else if (responseData.type === "mutation") {
        await loadItems();
      } else {
        throw new Error("Capture response had an invalid type");
      }
    } catch {
      setErrorMessage("The house could not process that note. Try again.");
    } finally {
      setIsCapturing(false);
    }
  }, [loadItems]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await captureInput(rawInput);
  }

  function toggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition =
      (window as SpeechRecognitionWindow).SpeechRecognition ??
      (window as SpeechRecognitionWindow).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMessage("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();

      if (!transcript) {
        setErrorMessage("No speech was detected. Try again.");
        return;
      }

      setRawInput(transcript);
      void captureInput(transcript);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setErrorMessage("Microphone access failed or no speech was detected.");
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setErrorMessage(null);
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
      setErrorMessage("The microphone could not be started. Try again.");
    }
  }

  async function completeItem(itemId: string) {
    setErrorMessage(null);

    const { error } = await supabase
      .from("whiteboard_items")
      .update({ is_completed: true })
      .eq("id", itemId);

    if (error) {
      setErrorMessage("That note could not be erased. Try again.");
      return;
    }

    await loadItems();
  }

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  return (
    <main className="min-h-screen bg-[#d9d4cb] px-4 py-6 text-slate-800 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col gap-5">
        <div className="relative min-h-[680px] flex-1 [perspective:1000px]">
          <div
            className={`relative h-full min-h-[680px] transition-transform duration-700 [transform-style:preserve-3d] ${isFlipped ? "rotate-y-180" : ""}`}
          >
            <section
              className="absolute inset-0 overflow-hidden rounded-[2rem] border-[10px] border-[#b7b2a9] bg-slate-50 p-4 shadow-[0_22px_45px_rgba(55,50,42,0.3),inset_0_0_0_2px_rgba(255,255,255,0.9),inset_0_0_24px_rgba(148,163,184,0.16)] [backface-visibility:hidden] sm:p-5"
              aria-label="Household whiteboard"
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.7),transparent_22%,transparent_78%,rgba(148,163,184,0.08))]" />
              <div className="relative flex h-full min-h-[680px] flex-col">
            <header className="mb-4 flex items-end justify-between border-b-2 border-slate-200/80 pb-3">
              <div>
                <p className="font-sans text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                  The household board
                </p>
                <h1 className={`${caveat.className} text-4xl font-bold leading-none text-slate-700`}>
                  Keep in sight
                </h1>
              </div>
              <span className={`${caveat.className} -rotate-3 text-2xl text-slate-400`}>
                {items.length} notes
              </span>
            </header>

            {isLoading ? (
              <BoardPlaceholder />
            ) : (
              <div className="grid flex-1 grid-cols-2 grid-rows-3 gap-3">
                {zones.map((zone) => (
                  <WhiteboardZone
                    key={zone.category}
                    zone={zone}
                    items={items.filter((item) => item.category === zone.category)}
                    headingClassName={caveat.className}
                    onComplete={completeItem}
                  />
                ))}
              </div>
            )}
              </div>
            </section>

            <section
              className="absolute inset-0 flex min-h-[680px] flex-col overflow-hidden rounded-[2rem] border-[10px] border-[#777a78] bg-[#8b8e8b] p-6 text-slate-100 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.18),inset_0_0_28px_rgba(31,41,55,0.22),0_22px_45px_rgba(55,50,42,0.3)] [backface-visibility:hidden] rotate-y-180"
              aria-label="Whiteboard response"
            >
              <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.22)_0.7px,transparent_0.7px)] [background-size:5px_5px]" />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-white/20 pb-3">
                  <p className={`${caveat.className} text-3xl font-bold text-white/90`}>House answer</p>
                  <button
                    type="button"
                    onClick={() => setIsFlipped(false)}
                    className="rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/80 transition hover:bg-white/10"
                  >
                    Back to board
                  </button>
                </div>
                <p className={`${caveat.className} mt-8 whitespace-pre-wrap text-3xl leading-tight text-white/95`}>
                  {queryResponse}
                </p>
              </div>
            </section>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-700/20 bg-slate-900 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.24)] sm:p-5">
          <form onSubmit={handleSubmit}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <label className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-slate-300" htmlFor="household-input">
                Tell the house
              </label>
              <span className="text-xs text-slate-500">Natural language</span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <input
                  id="household-input"
                  value={rawInput}
                  onChange={(event) => setRawInput(event.target.value)}
                  placeholder="Add a note, task, or reminder..."
                  className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 pr-14 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                  disabled={isCapturing}
                />
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  aria-label={isListening ? "Stop voice input" : "Start voice input"}
                  className={`absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-lg transition ${
                    isListening
                      ? "animate-pulse bg-rose-500 text-white"
                      : "text-slate-400 hover:bg-slate-700 hover:text-amber-300"
                  }`}
                >
                  <span aria-hidden="true" className="text-[10px] font-bold tracking-tight">
                    MIC
                  </span>
                </button>
              </div>
              <button
                type="submit"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-slate-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isCapturing}
              >
                {isCapturing && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" aria-hidden="true" />
                )}
                {isCapturing ? "Writing" : "Send to House"}
              </button>
            </div>
            {errorMessage && <p className="mt-3 text-sm text-rose-300" role="alert">{errorMessage}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}

function WhiteboardZone({
  zone,
  items,
  headingClassName,
  onComplete,
}: {
  zone: (typeof zones)[number];
  items: WhiteboardItem[];
  headingClassName: string;
  onComplete: (itemId: string) => void;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-xl border border-slate-200/80 ${zone.tint} p-3`}>
      <h2 className={`${headingClassName} mb-2 border-b border-slate-300/60 pb-1 text-[1.65rem] font-bold leading-none text-slate-600`}>
        {zone.label}
      </h2>
      {items.length === 0 ? (
        <p className={`${headingClassName} text-lg text-slate-400`}>Nothing here yet</p>
      ) : (
        <ul className="space-y-2 overflow-auto pr-1">
          {items.map(({ id, item_name, description }) => (
            <li
              className={`${headingClassName} cursor-pointer text-[1.35rem] leading-tight text-slate-700 transition hover:opacity-50 hover:line-through`}
              key={id}
              onClick={() => void onComplete(id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void onComplete(id);
                }
              }}
            >
              <p>{item_name}</p>
              {description && <p className="mt-0.5 text-[1.05rem] text-slate-500">{description}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BoardPlaceholder() {
  return (
    <div className="grid flex-1 grid-cols-2 grid-rows-3 gap-3" aria-label="Loading whiteboard">
      {zones.map((zone) => <div className={`animate-pulse rounded-xl ${zone.tint}`} key={zone.category} />)}
    </div>
  );
}
