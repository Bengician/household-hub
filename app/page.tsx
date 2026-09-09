"use client";

import { Caveat } from "next/font/google";
import {
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
      <div className="mx-auto flex h-[calc(100vh-3rem)] min-h-0 w-full max-w-md flex-col gap-5 sm:h-[calc(100vh-4rem)]">
        <div className="relative min-h-0 flex-1 [perspective:1000px]">
          <div
            className={`relative h-full min-h-0 transition-transform duration-700 [transform-style:preserve-3d] ${isFlipped ? "rotate-y-180" : ""}`}
          >
            <section
              className="absolute inset-0 overflow-hidden rounded-[2rem] border-[10px] border-[#b7b2a9] bg-slate-50 p-4 shadow-[0_22px_45px_rgba(55,50,42,0.3),inset_0_0_0_2px_rgba(255,255,255,0.9),inset_0_0_24px_rgba(148,163,184,0.16)] [backface-visibility:hidden] sm:p-5"
              aria-label="Household whiteboard"
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.7),transparent_22%,transparent_78%,rgba(148,163,184,0.08))]" />
              <div className="relative flex h-full min-h-0 flex-col">
                <header className="mb-4 flex items-center justify-between gap-3 border-b-2 border-slate-200/80 pb-3">
                  <h1 className={`${caveat.className} text-3xl font-bold leading-none text-slate-700 sm:text-4xl`}>
                    Ben and Em&apos;s Family Whiteboard
                  </h1>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`${caveat.className} -rotate-3 text-2xl text-slate-400`}>
                      {items.length} notes
                    </span>
                    <button
                      type="button"
                      onClick={toggleVoiceInput}
                      disabled={isCapturing}
                      aria-label={isListening ? "Stop voice input" : "Start voice input"}
                      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold tracking-tight shadow-[inset_0_2px_2px_rgba(255,255,255,0.7),0_4px_8px_rgba(71,85,105,0.28)] transition hover:-translate-y-0.5 hover:shadow-[inset_0_2px_2px_rgba(255,255,255,0.7),0_6px_12px_rgba(71,85,105,0.34)] disabled:cursor-not-allowed disabled:opacity-60 ${
                        isListening
                          ? "animate-pulse border-rose-600 bg-rose-500 text-white"
                          : "border-slate-300 bg-amber-200 text-slate-700 hover:bg-amber-300"
                      }`}
                    >
                      MIC
                    </button>
                  </div>
                </header>

                {isLoading ? (
                  <BoardPlaceholder />
                ) : (
                  <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3">
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
              className="absolute inset-0 flex min-h-0 flex-col overflow-hidden rounded-[2rem] border-[10px] border-[#777a78] bg-[#8b8e8b] p-6 text-slate-100 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.18),inset_0_0_28px_rgba(31,41,55,0.22),0_22px_45px_rgba(55,50,42,0.3)] [backface-visibility:hidden] rotate-y-180"
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
        {errorMessage && (
          <p className="text-center text-sm text-rose-700" role="alert">
            {errorMessage}
          </p>
        )}
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
    <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3" aria-label="Loading whiteboard">
      {zones.map((zone) => <div className={`animate-pulse rounded-xl ${zone.tint}`} key={zone.category} />)}
    </div>
  );
}
