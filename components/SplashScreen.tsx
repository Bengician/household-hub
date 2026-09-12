"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [isPopping, setIsPopping] = useState(false);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // 1. Brief pause before animating so the user registers the screen
    const popTimer = setTimeout(() => {
      setIsPopping(true);
      
      // Play sound effect
      const audio = new Audio("/pop.mp3");
      // Note: Browsers sometimes block autoplay audio if the user hasn't interacted with the screen yet. 
      // Installed PWAs often bypass this restriction, but we catch the error just in case.
      audio.play().catch((err) => console.log("Audio autoplay blocked by browser", err));
    }, 400);

    // 2. Trigger the full screen fade out after the cap finishes popping
    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, 1200);

    // 3. Unmount the splash screen completely to reveal the whiteboard
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
        {/* Marker Cap */}
        <div className={`z-10 ${isPopping ? "animate-pop-cap" : ""}`}>
          <Image
            src="/marker-cap.png"
            alt="Marker Cap"
            width={80}
            height={80}
            priority
          />
        </div>
        
        {/* Marker Body (Negative top margin to connect it seamlessly with the cap) */}
        <div className="z-0 -mt-2">
          <Image
            src="/marker-body.png"
            alt="Marker Body"
            width={80}
            height={200}
            priority
          />
        </div>
      </div>
    </div>
  );
}