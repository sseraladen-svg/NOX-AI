"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Layers, Network, ChevronRight, Sparkles, TrendingUp, Play, X, Subtitles, BookOpen, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMultiModel } from "@/store/multi-model-store";
import { UserMenu } from "./shared-chat";
import type { Mode } from "@/lib/multi-model-types";

const MODE_CARDS: {
  id: Mode;
  label: string;
  tagline: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  features: string[];
}[] = [
  {
    id: "SINGLE",
    label: "Single",
    tagline: "One model, every task",
    description:
      "Connect one model (API or Local CLI) and use it for all six feature types — chat, voice, vision, coding, automation, robotics. Simplest setup, fastest responses.",
    icon: Globe,
    accent: "from-foreground to-foreground/70",
    features: [
      "One config card",
      "All features share the model",
      "Single-step dispatch trace",
    ],
  },
  {
    id: "MULTI",
    label: "Multi",
    tagline: "Right model for each job",
    description:
      "Assign a different model to each of the 6 features. Use GPT-4o for chat, Claude for coding, Gemini for vision — each prompt routes to the best-fit model automatically.",
    icon: Layers,
    accent: "from-foreground/85 to-foreground/55",
    features: [
      "6 independent feature cards",
      "Per-feature provider + connection",
      "Intent-based routing",
    ],
  },
  {
    id: "ORCHESTRATOR",
    label: "Orchestrator",
    tagline: "Host routes to specialists",
    description:
      "A Host model reads your prompt, decides what kind of task it is, routes it to the right specialist (planning, coding, vision, automation, engineering), then synthesizes the final reply.",
    icon: Network,
    accent: "from-foreground/70 to-foreground/40",
    features: [
      "Host + 5 specialist cards",
      "Multi-agent confirmation flow",
      "3-step pipeline: analyze → specialist → synthesize",
    ],
  },
];

export function ModePicker() {
  const router = useRouter();
  const mm = useMultiModel();
  const [showDemo, setShowDemo] = React.useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = React.useState(true);
  const [showGuide, setShowGuide] = React.useState(false);
  const [guideType, setGuideType] = React.useState<"api" | "cli" | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const enterMode = async (mode: Mode) => {
    mm.setMode(mode);
    await mm.save();
    router.push(`/${mode.toLowerCase()}`);
  };

  const toggleSubtitles = () => {
    const newState = !subtitlesEnabled;
    setSubtitlesEnabled(newState);
    if (videoRef.current) {
      const tracks = videoRef.current.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = newState ? 'showing' : 'hidden';
      }
    }
  };

  const handleOpenDemo = () => {
    setShowDemo(true);
    // Reset subtitles to enabled when opening
    setSubtitlesEnabled(true);
  };

  // Handle subtitle state when video loads
  React.useEffect(() => {
    if (videoRef.current && showDemo) {
      const tracks = videoRef.current.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
      }
    }
  }, [showDemo, subtitlesEnabled]);

  return (
    <div className="min-h-screen bg-background nox-aurora">
      {/* Header */}
      <header className="nox-topbar sticky top-0 z-30 glass border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-foreground to-foreground/60 flex items-center justify-center nox-glow-sm">
              <span className="text-background font-bold text-sm">
                N
              </span>
            </div>
            <div className="leading-none">
              <div className="font-semibold tracking-tight text-slate-900">NOX AI</div>
              <div className="text-[10px] text-slate-600">
                Choose your mode
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/usage")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-muted/30 hover:bg-muted/60 text-slate-900 hover:text-slate-900 transition"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Usage</span>
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-10 sm:mb-14"
        >
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-foreground to-foreground/60 mb-4 nox-glow nox-pulse">
            <Sparkles className="h-7 w-7 text-background" />
          </div>
          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight mb-3">
            Welcome to <span className="nox-text-gradient">NOX AI</span>
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Three ways to wield multi-model intelligence. Pick the mode that
            matches your task — you can switch any time.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="mb-6 sm:mb-8 flex flex-col sm:flex-row gap-3 justify-center"
        >
          <motion.button
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            onClick={handleOpenDemo}
            className="group relative rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 transition overflow-hidden px-6 py-3 flex items-center gap-3 shadow-[0_0_30px_rgba(168,85,247,0.15)]"
          >
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Play className="h-5 w-5 text-background fill-background" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">Demo</p>
              <p className="text-xs text-muted-foreground">About the product</p>
            </div>
          </motion.button>

          <motion.button
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            onClick={() => setShowGuide(true)}
            className="group relative rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 transition overflow-hidden px-6 py-3 flex items-center gap-3 shadow-[0_0_30px_rgba(168,85,247,0.15)]"
          >
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-background" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">API & CLI Setup Guide</p>
              <p className="text-xs text-muted-foreground">Connection instructions</p>
            </div>
          </motion.button>
        </motion.div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {MODE_CARDS.map((card, i) => {
            const Icon = card.icon;
            const active = mm.mode === card.id;
            return (
              <motion.button
                key={card.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                onClick={() => enterMode(card.id)}
                className={`group relative text-left rounded-2xl border p-6 transition overflow-hidden ${
                  active
                    ? "border-primary/50 bg-primary/5 nox-glow-sm"
                    : "border-border bg-card/40 hover:bg-card/70 hover:border-primary/30"
                }`}
              >
                {/* Gradient icon */}
                <div
                  className={`h-12 w-12 rounded-xl bg-gradient-to-br ${card.accent} flex items-center justify-center mb-4 nox-glow-sm`}
                >
                  <Icon className="h-6 w-6 text-background" />
                </div>

                <div className="flex items-baseline gap-2 mb-1">
                  <h2 className="text-xl font-semibold">{card.label}</h2>
                  {active && (
                    <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-primary/80 font-medium mb-3">
                  {card.tagline}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {card.description}
                </p>

                <ul className="space-y-1.5 mb-5">
                  {card.features.map((f) => (
                    <li
                      key={f}
                      className="text-xs text-muted-foreground flex items-start gap-2"
                    >
                      <span className="text-primary mt-0.5">•</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                  Enter {card.label} mode
                  <ChevronRight className="h-4 w-4" />
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-muted-foreground mt-10"
        >
          All modes support API Key + Local CLI connections, per-role timeout
          overrides, encrypted API keys, and the multi-agent confirmation flow.
        </motion.p>
      </main>

      {/* Demo Video Modal */}
      <AnimatePresence>
        {showDemo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowDemo(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-4xl bg-card rounded-2xl border border-border overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">NOX AI Demo</h3>
                  <p className="text-xs text-muted-foreground">About the product</p>
                </div>
                <button
                  onClick={() => setShowDemo(false)}
                  className="h-8 w-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition"
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>
              </div>

              {/* Video Container */}
              <div className="relative bg-black">
                <video
                  ref={videoRef}
                  className="w-full aspect-video"
                  controls
                  playsInline
                  autoPlay
                >
                  <source src="https://raw.githubusercontent.com/sseraladen-svg/NOX-AI/main/public/videos/nox-demo.mp4" type="video/mp4" />
                  <track
                    src="https://raw.githubusercontent.com/sseraladen-svg/NOX-AI/main/public/videos/nox-demo.vtt"
                    kind="subtitles"
                    srcLang="en"
                    label="English"
                    default
                  />
                  Your browser does not support the video tag.
                </video>

                {/* Subtitle Toggle Button */}
                <button
                  onClick={toggleSubtitles}
                  className="absolute bottom-16 right-4 h-10 w-10 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center transition border border-white/20"
                  title={subtitlesEnabled ? "Disable subtitles" : "Enable subtitles"}
                >
                  <Subtitles className={`h-5 w-5 ${subtitlesEnabled ? "text-white" : "text-white/50"}`} />
                </button>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-border flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Learn about NOX AI's multi-model platform features
                </p>
                <button
                  onClick={() => setShowDemo(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-primary hover:bg-primary/90 text-background transition"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setup Guide Modal */}
      <AnimatePresence>
        {showGuide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowGuide(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-4xl max-h-[90vh] bg-card rounded-2xl border border-border overflow-hidden shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">API & CLI Setup Guide</h3>
                  <p className="text-xs text-muted-foreground">Choose your connection type</p>
                </div>
                <button
                  onClick={() => setShowGuide(false)}
                  className="h-8 w-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition"
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>
              </div>

              {/* Content */}
              {!guideType ? (
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button
                      onClick={() => setGuideType("api")}
                      className="group relative rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 transition overflow-hidden p-6 text-left"
                    >
                      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4">
                        <Settings2 className="h-6 w-6 text-background" />
                      </div>
                      <h4 className="text-lg font-semibold text-foreground mb-2">API Connection Guide</h4>
                      <p className="text-sm text-muted-foreground">
                        Connect NOX AI to an AI provider using an API key. Follow step-by-step instructions for secure setup.
                      </p>
                    </button>

                    <button
                      onClick={() => setGuideType("cli")}
                      className="group relative rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 transition overflow-hidden p-6 text-left"
                    >
                      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4">
                        <Settings2 className="h-6 w-6 text-background" />
                      </div>
                      <h4 className="text-lg font-semibold text-foreground mb-2">CLI Connection Guide</h4>
                      <p className="text-sm text-muted-foreground">
                        Connect NOX AI to a local AI runtime such as Ollama. Follow PowerShell setup instructions.
                      </p>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-6">
                  <button
                    onClick={() => setGuideType(null)}
                    className="mb-4 text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    ← Back to guide selection
                  </button>

                  {guideType === "api" ? (
                    <div className="space-y-6">
                      <h2 className="text-2xl font-bold text-foreground">API Connection Guide</h2>
                      <p className="text-muted-foreground">Use this guide to connect NOX AI to an AI provider using an API key.</p>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">1. Select Your Provider</h3>
                        <p className="text-muted-foreground">In NOX AI, select:</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Connection → API → Provider</p>
                        <p className="text-muted-foreground">Choose the AI provider you want to use.</p>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">2. Enter Your API Key</h3>
                        <p className="text-muted-foreground">Enter the API key provided by your provider.</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>API Key: ************************</code></pre>
                        <p className="text-muted-foreground">Make sure the key is valid and has access to the provider's API.</p>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">3. Check Available Models</h3>
                        <p className="text-muted-foreground">After entering the API key, click:</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Check Available Models</p>
                        <p className="text-muted-foreground">NOX AI will verify the API key and retrieve the models available from the provider.</p>
                        <p className="text-muted-foreground">Select the model you want to use.</p>

                        <h4 className="text-md font-semibold text-foreground mt-4">Model Not Listed?</h4>
                        <p className="text-muted-foreground">If your required model does not appear in the available-model list:</p>
                        <ol className="list-decimal list-inside text-muted-foreground space-y-1">
                          <li>Select <strong>Custom Model</strong>.</li>
                          <li>Enter the <strong>exact model name/model ID provided by the AI provider</strong>.</li>
                          <li>Do not use an approximate name or display name.</li>
                        </ol>
                        <p className="text-muted-foreground mt-2">Example:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>Custom Model:
exact-provider-model-name</code></pre>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">4. Test the Connection</h3>
                        <p className="text-muted-foreground">After selecting or entering the model, click:</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Test Connection</p>
                        <p className="text-muted-foreground">NOX AI will verify the provider, API key, and selected model.</p>
                        <p className="text-muted-foreground">Wait until the connection is successfully verified.</p>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">5. Save Configuration</h3>
                        <p className="text-muted-foreground">Only save the configuration after the test succeeds.</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Test Successful → Verified → Save Configuration</p>
                        <p className="text-muted-foreground">Once saved, the configuration is ready to use throughout NOX AI.</p>
                      </div>

                      <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
                        <h4 className="font-semibold text-primary mb-2">Important</h4>
                        <p className="text-muted-foreground"><strong>Always test and verify the API connection before saving it.</strong></p>
                        <p className="text-muted-foreground">If verification fails, do not save the configuration. Check the API key, provider, and exact model name and test again.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <h2 className="text-2xl font-bold text-foreground">CLI Connection Guide</h2>
                      <p className="text-muted-foreground">Use this guide to connect NOX AI to a local AI runtime such as Ollama.</p>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">1. Install and Check Ollama</h3>
                        <p className="text-muted-foreground">Make sure Ollama is installed.</p>
                        <p className="text-muted-foreground">Open PowerShell:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>ollama --version</code></pre>
                        <p className="text-muted-foreground">Pull the model you want to use:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>ollama pull llama3.1:8b</code></pre>
                        <p className="text-muted-foreground">Check your installed models:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>ollama list</code></pre>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">2. Set the NOX AI Origin</h3>
                        <p className="text-muted-foreground">NOX AI needs permission to communicate with Ollama running on your computer.</p>
                        <p className="text-muted-foreground">Run:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>[Environment]::SetEnvironmentVariable(
  "OLLAMA_ORIGINS",
  "https://nox-ai-ten.vercel.app",
  "User"
)</code></pre>
                        <p className="text-muted-foreground">Verify the setting:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>[Environment]::GetEnvironmentVariable("OLLAMA_ORIGINS","User")</code></pre>
                        <p className="text-muted-foreground">It should show:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>https://nox-ai-ten.vercel.app</code></pre>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">3. Completely Restart Ollama</h3>
                        <p className="text-muted-foreground">This step is required after setting or changing the origin.</p>
                        <ol className="list-decimal list-inside text-muted-foreground space-y-1">
                          <li>Completely close Ollama.</li>
                          <li>Make sure Ollama is no longer running.</li>
                          <li>Open PowerShell.</li>
                          <li>Start Ollama:</li>
                        </ol>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>ollama serve</code></pre>
                        <p className="text-muted-foreground">Keep this terminal running.</p>
                        <p className="text-muted-foreground"><strong>Do not skip the restart.</strong> Ollama must restart to load the new <code>OLLAMA_ORIGINS</code> setting.</p>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">4. Verify Ollama</h3>
                        <p className="text-muted-foreground">Open another PowerShell window.</p>
                        <p className="text-muted-foreground">Check the Ollama port:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>Test-NetConnection 127.0.0.1 -Port 11434</code></pre>
                        <p className="text-muted-foreground">Expected:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>TcpTestSucceeded : True</code></pre>
                        <p className="text-muted-foreground">Check the Ollama API:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>Invoke-RestMethod http://127.0.0.1:11434/api/tags</code></pre>
                        <p className="text-muted-foreground">Check installed models:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>ollama list</code></pre>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">5. Connect Ollama to NOX AI</h3>
                        <p className="text-muted-foreground">In NOX AI, select:</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Connection → CLI → Ollama</p>
                        <p className="text-muted-foreground">Select the model you want to use.</p>
                        <p className="text-muted-foreground">Example:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>Provider: Ollama
Model: llama3.1:8b</code></pre>

                        <h4 className="text-md font-semibold text-foreground mt-4">Model Not Listed?</h4>
                        <p className="text-muted-foreground">If the model does not appear in NOX AI:</p>
                        <ol className="list-decimal list-inside text-muted-foreground space-y-1">
                          <li>Select Custom Model.</li>
                          <li>Enter the exact model name shown by Ollama.</li>
                          <li>The name must match exactly.</li>
                        </ol>
                        <p className="text-muted-foreground mt-2">Example:</p>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>Custom Model:
llama3.1:8b</code></pre>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">6. Test the Connection</h3>
                        <p className="text-muted-foreground">Click:</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Test Connection</p>
                        <p className="text-muted-foreground">NOX AI will verify:</p>
                        <ul className="list-disc list-inside text-muted-foreground space-y-1">
                          <li>Ollama is reachable.</li>
                          <li>The local endpoint is responding.</li>
                          <li>The selected model exists.</li>
                          <li>The model can respond.</li>
                        </ul>
                        <p className="text-muted-foreground">Wait until the connection is successfully verified.</p>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">7. Save Configuration</h3>
                        <p className="text-muted-foreground">Only save after successful verification.</p>
                        <p className="font-mono text-sm bg-muted p-2 rounded">Test Successful → Verified → Save Configuration</p>
                        <p className="text-muted-foreground">The CLI configuration is then ready to use.</p>
                      </div>

                      <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
                        <h4 className="font-semibold text-primary mb-2">Important</h4>
                        <p className="text-muted-foreground">Set the origin → Completely restart Ollama → Connect → Test → Verify → Save.</p>
                        <p className="text-muted-foreground">No Cloudflare Tunnel is required.</p>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground">Connection Flow</h3>
                        <pre className="bg-muted p-3 rounded text-sm overflow-x-auto"><code>Set OLLAMA_ORIGINS
        ↓
Restart Ollama
        ↓
Start Ollama
        ↓
Connect NOX AI
        ↓
Select Model
        ↓
Test Connection
        ↓
Verify
        ↓
Save Configuration</code></pre>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="p-4 border-t border-border flex items-center justify-between shrink-0">
                <p className="text-xs text-muted-foreground">
                  Follow the steps carefully to ensure successful connection
                </p>
                <button
                  onClick={() => setShowGuide(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-primary hover:bg-primary/90 text-background transition"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
