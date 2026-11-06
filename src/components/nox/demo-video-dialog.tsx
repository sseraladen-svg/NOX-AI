"use client";

import * as React from "react";
import { Subtitles } from "lucide-react";
import {
  DialogClose,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DemoVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DemoVideoDialog({
  open,
  onOpenChange,
}: DemoVideoDialogProps) {
  const [subtitlesEnabled, setSubtitlesEnabled] = React.useState(true);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (open) setSubtitlesEnabled(true);
  }, [open]);

  const updateSubtitleTracks = React.useCallback(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;

    for (let index = 0; index < tracks.length; index += 1) {
      tracks[index].mode = subtitlesEnabled ? "showing" : "hidden";
    }
  }, [subtitlesEnabled]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) videoRef.current?.pause();
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    updateSubtitleTracks();
  }, [open, updateSubtitleTracks]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>NOX AI Demo</DialogTitle>
          <DialogDescription>About the product</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-video rounded-lg bg-black">
          <video
            ref={videoRef}
            className="h-full w-full"
            src="/videos/nox-demo.mp4"
            controls
            playsInline
            autoPlay
            onLoadedMetadata={updateSubtitleTracks}
          >
            <track
              src="/videos/nox-demo.vtt"
              kind="subtitles"
              srcLang="en"
              label="English"
              default={subtitlesEnabled}
            />
          </video>
          <button
            type="button"
            aria-label={subtitlesEnabled ? "Disable subtitles" : "Enable subtitles"}
            aria-pressed={subtitlesEnabled}
            onClick={() => setSubtitlesEnabled((enabled) => !enabled)}
            className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80"
          >
            <Subtitles
              className={`h-5 w-5 ${subtitlesEnabled ? "text-white" : "text-white/50"}`}
            />
          </button>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
