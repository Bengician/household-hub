"use client";
import { useEffect, useState, useRef } from "react";
import Image from "next/image";

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [isPopping, setIsPopping] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const hasPlayedAudio = useRef(false);

  useEffect(() => {
    const popTimer = setTimeout(() => {
      setIsPopping(true);
      if (!hasPlayedAudio.current) {
        hasPlayedAudio.current = true;
        const audio = new Audio("/pop.mp3");
        audio.play().catch((err) => console.log("Audio autoplay blocked", err));
      }
    }, 400);

    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, 1200);

    const unmountTimer = setTimeout(() => {
      onComplete();
    }, 1600);

    return () => {
      clearTimeout(popTimer);
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#fdfbf7] ${
        isFading ? "animate-fade-out" : ""
      }`}
    >
      <div className="relative flex justify-center w-[120px] h-[340px]">
        {/* Marker Body */}
        <div className="absolute top-0 z-0">
          <Image
            src="/marker-body.svg"
            alt="Marker Body"
            width={120}
            height={340}
            priority
          />
        </div>
        
        {/* Marker Cap (Absolute positioned to slide exactly over the tip) */}
        <div className={`absolute top-0 z-10 ${isPopping ? "animate-pop-cap" : ""}`}>
          <Image
            src="/marker-cap.svg" 
            alt="Marker Cap"
            width={120}
            height={100}
            priority
          />
        </div>
      </div>
    </div>
  );
}