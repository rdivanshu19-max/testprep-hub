import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RankersTestHub — JEE & NEET CBT Platform" },
      {
        name: "description",
        content:
          "A premium CBT ecosystem for JEE Main, JEE Advanced & NEET aspirants — NTA-faithful test engine, deep analytics, mistake journal, topper comparison.",
      },
      { property: "og:title", content: "RankersTestHub — JEE & NEET CBT Platform" },
      {
        property: "og:description",
        content: "NTA-faithful CBT for JEE & NEET. Real practice. Real reports.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-foreground) 1px, transparent 1px), linear-gradient(90deg, var(--color-foreground) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="mx-auto max-w-7xl px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Built for JEE Main, JEE Advanced & NEET
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
              The CBT platform that <span className="text-primary">feels like the real exam.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Take NTA-faithful tests, see exactly where you lose marks, and close the gap with toppers — all in a single, premium workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/auth" search={{ mode: "signup" } as never}>
                <Button size="lg">Start practicing free</Button>
              </Link>
              <a href="#cbt">
                <Button size="lg" variant="outline">See the CBT engine</Button>
              </a>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-3 gap-6 border-t border-border pt-6 text-sm">
              <Stat value="180" label="min full mock" />
              <Stat value="100%" label="NTA-style UI" />
              <Stat value="0" label="cartoons & gradients" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <SectionTitle eyebrow="What's inside" title="Everything serious aspirants need." />
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="bg-card p-6">
                <div className="font-mono text-xs text-muted-foreground">{f.tag}</div>
                <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CBT PREVIEW */}
      <section id="cbt" className="border-b border-border bg-secondary/30">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <SectionTitle eyebrow="CBT Engine" title="NTA interface, modern engineering." align="left" />
            <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
              {[
                "Question palette with all 5 states color-coded",
                "Per-section timers, fullscreen lock, auto-save",
                "Mark for review, save & next, clear response",
                "Language selector, question zoom, bookmarks",
                "Auto-submit on timer-out — never lose an attempt",
              ].map((x) => (
                <li key={x} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-foreground" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3 text-xs">
              <div className="font-medium">JEE Main Mock 12 · Physics</div>
              <div className="font-mono text-primary">02 : 47 : 33</div>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_180px] gap-4">
              <div className="space-y-3 text-sm">
                <div className="text-xs text-muted-foreground">Question 14 · Single correct · +4 / −1</div>
                <div className="text-foreground">
                  A particle of mass <span className="font-mono">m</span> moves under a central force&nbsp;
                  <span className="font-mono">F = −k/r²</span>. The angular momentum is conserved because…
                </div>
                <div className="space-y-2 pt-1">
                  {["The force passes through the origin", "Energy is conserved", "The torque about origin is zero", "Mass is constant"].map(
                    (o, i) => (
                      <div key={i} className="rounded-md border border-border px-3 py-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{"ABCD"[i]}.</span>{" "}
                        {o}
                      </div>
                    ),
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Palette</div>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {Array.from({ length: 30 }).map((_, i) => {
                    const states = ["bg-muted", "bg-destructive/80 text-destructive-foreground", "bg-success/80 text-success-foreground", "bg-primary/80 text-primary-foreground"];
                    const s = states[i % 4];
                    return (
                      <div
                        key={i}
                        className={`grid h-7 place-items-center rounded font-mono text-[10px] ${s}`}
                      >
                        {i + 1}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ANALYTICS PREVIEW */}
      <section id="analytics" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <SectionTitle eyebrow="Reports" title="Know exactly where you bleed marks." />
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {[
              { k: "Accuracy", v: "76.4%", d: "↑ 4.1 vs last test" },
              { k: "Avg time / Q", v: "1:42", d: "↓ 12s vs last test" },
              { k: "Topper gap", v: "−18 marks", d: "Closes after weak-chapter drill" },
            ].map((c) => (
              <div key={c.k} className="rounded-xl border border-border bg-card p-6">
                <div className="text-xs text-muted-foreground">{c.k}</div>
                <div className="mt-2 font-mono text-3xl font-semibold tracking-tight">{c.v}</div>
                <div className="mt-1 text-xs text-muted-foreground">{c.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <SectionTitle eyebrow="FAQ" title="Common questions." />
          <dl className="mt-10 divide-y divide-border border-y border-border">
            {faq.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="text-sm font-medium">{f.q}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">Ready when you are.</h3>
            <p className="mt-1 text-sm opacity-70">Create an account and take your first mock in under a minute.</p>
          </div>
          <Link to="/auth" search={{ mode: "signup" } as never}>
            <Button size="lg" variant="secondary">Create account</Button>
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-7xl px-6 py-10 text-xs text-muted-foreground">
        © {new Date().getFullYear()} RankersTestHub. All rights reserved.
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{eyebrow}</div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
    </div>
  );
}

const features = [
  { tag: "01 / Engine", title: "NTA-faithful CBT", body: "Pixel-accurate test interface. Your students don't relearn the UI on exam day." },
  { tag: "02 / Reports", title: "Forensic analytics", body: "Per-question, per-topic, per-chapter, per-attempt. Time-wasters surfaced automatically." },
  { tag: "03 / Mistake Journal", title: "Never lose a wrong question", body: "Every miss is captured with your reasoning + the right one. Built for spaced review." },
  { tag: "04 / Topper Comparison", title: "See the gap", body: "Compare your attempt against top-percentile aggregates on the same test." },
  { tag: "05 / Practice", title: "Targeted drills", body: "Filter by exam, chapter, topic, difficulty, PYQ. Drill what's weak, not what's easy." },
  { tag: "06 / Resources", title: "Notes & formula sheets", body: "Clean PDFs, DPPs, PYQs and video solutions — admin curated, not scraped." },
];

const faq = [
  { q: "Is this only for JEE?", a: "No. JEE Main, JEE Advanced and NEET are all first-class. Each has its own paper structure, marking scheme and analytics." },
  { q: "Can coaching institutes use it?", a: "Yes. Admins create tests and questions; the same engine serves all students." },
  { q: "Where do the questions come from?", a: "Admins upload official PDFs (PYQs, mock papers). Our pipeline converts them into a structured CBT with full review before publish." },
  { q: "Will the test interface feel like the real NTA exam?", a: "That's the explicit design goal — palette, controls, timer, marking scheme, fullscreen flow." },
];
