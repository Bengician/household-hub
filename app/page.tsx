"use client";

import { Caveat } from "next/font/google";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { supabase } from "../lib/supabase";
import SplashScreen from "../components/SplashScreen";

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

type Category =
  | "groceries"
  | "hardware_home"
  | "storage_log"
  | "action_items";

type WhiteboardItem = {
  id: string;
  item_name: string;
  category: Category;
  description: string | null;
};

type MutationResponseItem = {
  action?: unknown;
  item_name?: unknown;
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
    label: "Home & Tools",
    tint: "bg-sky-50/80",
  },
  { category: "storage_log", label: "Storage Log", tint: "bg-emerald-50/80" },
  { category: "action_items", label: "Action Items", tint: "bg-rose-50/80" },
];

export default function Home() {
  const [showSplash, setShowSplash] = useState(true);
  const [items, setItems] = useState<WhiteboardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [processingTranscript, setProcessingTranscript] = useState("");
  const [isFlipped, setIsFlipped] = useState(false);
  const [queryResponse, setQueryResponse] = useState("");
  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set());
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(
    () => new Set(),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const deletionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadItems = useCallback(async (newItemNames: string[] = []) => {
    setIsLoading(true);

    const { data, error } = await supabase
      .from("whiteboard_items")
      .select("id, item_name, category, description")
      .eq("is_completed", false)
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMessage("The whiteboard could not be loaded.");
    } else {
      const loadedItems = (data ?? []) as WhiteboardItem[];
      setItems(loadedItems);

      if (newItemNames.length > 0) {
        const addedIds = new Set(
          loadedItems
            .filter((item) =>
              newItemNames.some(
                (name) => name.toLowerCase() === item.item_name.toLowerCase(),
              ),
            )
            .map((item) => item.id),
        );
        setNewItemIds(addedIds);
        if (animationTimerRef.current) {
          clearTimeout(animationTimerRef.current);
        }
        animationTimerRef.current = setTimeout(() => {
          setNewItemIds(new Set());
          animationTimerRef.current = null;
        }, 700);
      }
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
        items?: MutationResponseItem[];
      };

      if (responseData.type === "query" && typeof responseData.answer === "string") {
        setQueryResponse(responseData.answer);
        setIsFlipped(true);
      } else if (responseData.type === "mutation") {
        const addedItemNames = (responseData.items ?? [])
          .filter(
            (item) =>
              item.action === "add" && typeof item.item_name === "string",
          )
          .map((item) => item.item_name as string);
        await loadItems(addedItemNames);
      } else {
        throw new Error("Capture response had an invalid type");
      }
    } catch {
      setErrorMessage("The house could not process that note. Try again.");
    } finally {
      setIsCapturing(false);
      setProcessingTranscript("");
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

      setProcessingTranscript(transcript);
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

  const deleteItem = useCallback(async (itemId: string) => {
    setErrorMessage(null);

    const { error } = await supabase
      .from("whiteboard_items")
      .delete()
      .eq("id", itemId);

    if (error) {
      setErrorMessage("That note could not be erased. Try again.");
      setPendingDeletions((pending) => {
        const nextPending = new Set(pending);
        nextPending.delete(itemId);
        return nextPending;
      });
      return;
    }

    deletionTimersRef.current.delete(itemId);
    setPendingDeletions((pending) => {
      const nextPending = new Set(pending);
      nextPending.delete(itemId);
      return nextPending;
    });
    await loadItems();
  }, [loadItems]);

  function queueItemDeletion(itemId: string) {
    if (pendingDeletions.has(itemId)) {
      return;
    }

    setPendingDeletions((pending) => new Set(pending).add(itemId));
    const timer = setTimeout(() => {
      void deleteItem(itemId);
    }, 4000);
    deletionTimersRef.current.set(itemId, timer);
  }

  function undoLatestDeletion() {
    const pendingItems = Array.from(pendingDeletions);
    const itemId = pendingItems[pendingItems.length - 1];

    if (!itemId) {
      return;
    }

    const timer = deletionTimersRef.current.get(itemId);
    if (timer) {
      clearTimeout(timer);
      deletionTimersRef.current.delete(itemId);
    }

    setPendingDeletions((pending) => {
      const nextPending = new Set(pending);
      nextPending.delete(itemId);
      return nextPending;
    });
  }

  useEffect(() => {
    const deletionTimers = deletionTimersRef.current;

    return () => {
      recognitionRef.current?.stop();
      deletionTimers.forEach((timer) => clearTimeout(timer));
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      
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
                      Ben and Em&apos;s Whiteboard
                    </h1>
                    <div className="flex shrink-0 items-center gap-3">
                      <div
                        className={`relative flex items-center shrink-0 group w-40 h-10 transition-all ${
                          isCapturing
                            ? "pointer-events-none opacity-60"
                            : "cursor-pointer hover:scale-105"
                        }`}
                        role="button"
                        tabIndex={isCapturing ? -1 : 0}
                        aria-label={isListening ? "Stop voice input" : "Start voice input"}
                        aria-disabled={isCapturing}
                        onClick={toggleVoiceInput}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleVoiceInput();
                          }
                        }}
                      >
                        {/* Glow */}
                        <div
                          className={`absolute inset-0 rounded-full transition-all duration-300 ${
                            isListening
                              ? "bg-amber-300 opacity-100 blur-xl scale-125 animate-pulse"
                              : "bg-white opacity-0 group-hover:opacity-40 blur-lg"
                          }`}
                        />

                        <div className="relative flex items-center w-full h-8 mt-1.5">

                          {/* Static marker body — shadow belongs ONLY here */}
                          <div className="relative flex items-center flex-1 h-8 drop-shadow-md">

                            {/* Revealed tip */}
                            <div className="flex items-center justify-end w-11 h-8">
                              <div className="w-3 h-3 bg-blue-800 rounded-l-sm" />
                              <div className="w-3 h-6 bg-slate-300 border-y border-slate-300" />
                            </div>

                            {/* Barrel */}
                            <div className="relative z-10 flex items-center justify-center flex-1 h-8 bg-slate-50 border-y border-slate-300">
                              {/* Accent stripe */}
                              <div className="absolute left-1 w-1.5 h-full bg-blue-700" />

                              {/* Microphone */}
                              <svg
                                className="w-3.5 h-3.5 text-slate-400 ml-2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19 10v1a7 7 0 01-14 0v-1M12 18.5V23M8 23h8"
                                />
                              </svg>
                            </div>

                            {/* End plug */}
                            <div className="w-3 h-6 bg-blue-700 rounded-r-md" />
                          </div>

                          {/* Cap — completely independent from the shadow */}
                          <div
                            className={`absolute left-0 z-30 origin-bottom-left transition-all duration-300 ease-out ${
                              isListening
                                ? "-translate-x-6 -translate-y-4 -rotate-45 opacity-0"
                                : "translate-x-0 translate-y-0 rotate-0 opacity-100"
                            }`}
                          >
                            <div className="w-11 h-8 bg-blue-700 rounded-l-md border-r border-slate-300" />
                          </div>

                        </div>
                      </div>
                    </div>
                  </header>
                
                  {processingTranscript && isCapturing && (
                    <div className="mb-3 flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-center shadow-sm">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
                      <span className={`${caveat.className} truncate text-xl text-slate-600`}>
                        {processingTranscript}
                      </span>
                    </div>
                  )}

                  {isLoading ? (
                    <BoardPlaceholder />
                  ) : (
                    <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
                      {zones.map((zone) => (
                        <WhiteboardZone
                          key={zone.category}
                          zone={zone}
                          items={items.filter((item) => item.category === zone.category)}
                          headingClassName={caveat.className}
                          onComplete={queueItemDeletion}
                          pendingDeletions={pendingDeletions}
                          newItemIds={newItemIds}
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
        {pendingDeletions.size > 0 && (
          <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-5 rounded-full bg-slate-900 px-5 py-3 text-sm text-white shadow-xl">
            <span>Note crossed out</span>
            <button
              type="button"
              onClick={undoLatestDeletion}
              className="font-bold text-amber-300 transition hover:text-amber-200"
            >
              Undo
            </button>
          </div>
        )}
      </main>
    </>
  );
}

function WhiteboardZone({
  zone,
  items,
  headingClassName,
  onComplete,
  pendingDeletions,
  newItemIds,
}: {
  zone: (typeof zones)[number];
  items: WhiteboardItem[];
  headingClassName: string;
  onComplete: (itemId: string) => void;
  pendingDeletions: Set<string>;
  newItemIds: Set<string>;
}) {
  return (
    <section className={`flex min-h-[12rem] flex-col rounded-xl border border-slate-200/80 ${zone.tint} p-3`}>
      <h2 className={`${headingClassName} mb-2 border-b border-slate-300/60 pb-1 text-[1.65rem] font-bold leading-none text-slate-600`}>
        {zone.label}
      </h2>
      {items.length === 0 ? (
        <p className={`${headingClassName} text-lg text-slate-400`}>Nothing here yet</p>
      ) : (
        <ul className="space-y-2 overflow-auto pr-1">
          {items.map(({ id, item_name, description }) => (
            <li
              className={`${headingClassName} cursor-pointer text-[1.35rem] leading-tight text-slate-700 transition hover:opacity-50 hover:line-through ${pendingDeletions.has(id) ? "line-through opacity-50" : ""}`}
              key={id}
              style={newItemIds.has(id) ? { animation: "handwriting 600ms ease-out both" } : undefined}
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
    <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3" aria-label="Loading whiteboard">
      {zones.map((zone) => <div className={`animate-pulse rounded-xl ${zone.tint}`} key={zone.category} />)}
    </div>
  );
}