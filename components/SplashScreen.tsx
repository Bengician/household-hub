"use client";
import { useEffect, useState, useRef } from "react";
import Image from "next/image";

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [isPopping, setIsPopping] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const hasPlayedAudio = useRef(false); // Tracks audio to prevent double-play

  useEffect(() => {
    const popTimer = setTimeout(() => {
      setIsPopping(true);
      
      // Play sound only once, bypassing Strict Mode double-fires
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
      <div className="relative flex flex-col items-center">
        {/* Marker Cap - explicitly targeting .svg */}
        <div className={`z-10 ${isPopping ? "animate-pop-cap" : ""}`}>
          <Image
            src="/marker-cap.svg" 
            alt="Marker Cap"
            width={80}
            height={67}
            priority
          />
        </div>
        
        {/* Marker Body - explicitly targeting .svg */}
        <div className="z-0 -mt-2">
          <Image
            src="/marker-body.svg"
            alt="Marker Body"
            width={80}
            height={146}
            priority
          />
        </div>
      </div>
    </div>
  );
}