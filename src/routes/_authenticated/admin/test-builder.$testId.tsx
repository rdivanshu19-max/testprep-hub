import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check } from "lucide-react";


import {
  getTestForEdit,
  importQuestionsFromText,
  removeTestQuestion,
  setTestStatus,
  updateTestMeta,
  upsertQuestion,
} from "@/lib/tests.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { InlineMath } from "@/components/math";

export const Route = createFileRoute("/_authenticated/admin/test-builder/$testId")({
  head: () => ({ meta: [{ title: "Test builder — Admin" }] }),
  component: Builder,
});

type QuestionForm = {
  id?: string;
  question_text: string;
  options: Record<string, string>;
  correct_answer: string;
  type: "single_correct" | "integer";
};

const emptyQuestion = (): QuestionForm => ({
  question_text: "",
  options: { A: "", B: "", C: "", D: "" },
  correct_answer: "A",
  type: "single_correct",
});

function Builder() {
  const { testId } = Route.useParams();
  const qc = useQueryClient();
  const getTest = useServerFn(getTestForEdit);
  const upsert = useServerFn(upsertQuestion);
  const remove = useServerFn(removeTestQuestion);
  const updateMeta = useServerFn(updateTestMeta);
  const importText = useServerFn(importQuestionsFromText);
  const publish = useServerFn(setTestStatus);

  const { data, isLoading } = useQuery({
    queryKey: ["test-builder", testId],
    queryFn: () => getTest({ data: { testId } }),
  });

  const [tab, setTab] = useState<"build" | "import">("build");
  const [current, setCurrent] = useState<QuestionForm>(emptyQuestion());
  const [importInput, setImportInput] = useState("");

  const refetch = () => qc.invalidateQueries({ queryKey: ["test-builder", testId] });

  const saveQ = useMutation({
    mutationFn: async (q: QuestionForm) => {
      const order = data?.questions.length ?? 0;
      return upsert({
        data: {
          testId,
          order_index: q.id ? 0 : order,
          question: {
            ...q,
            difficulty: "medium",
          },
        },
      });
    },
    onSuccess: () => {
      toast.success("Question saved");
      setCurrent(emptyQuestion());
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (questionId: string) => remove({ data: { testId, questionId } }),
    onSuccess: () => {
      toast.success("Removed");
      refetch();
    },
  });

  const runImport = useMutation({
    mutationFn: () => importText({ data: { testId, text: importInput } }),
    onSuccess: (r) => {
      toast.success(`Imported ${r.inserted} question(s)${r.note ? ` — ${r.note}` : ""}`);
      setImportInput("");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doPublish = useMutation({
    mutationFn: (status: "draft" | "published") => publish({ data: { testId, status } }),
    onSuccess: () => {
      toast.success("Status updated");
      refetch();
    },
  });

  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(60);
  useEffect(() => {
    if (data?.test) {
      setTitle(data.test.title);
      setDuration(data.test.duration_min);
    }
  }, [data?.test]);

  const saveMeta = useMutation({
    mutationFn: () =>
      updateMeta({ data: { testId, title, duration_min: duration } }),
    onSuccess: () => toast.success("Test details saved"),
  });

  if (isLoading || !data) {
    return <main className="p-8 text-muted-foreground">Loading test builder…</main>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link to="/admin/tests" className="text-xs text-muted-foreground hover:underline">
            ← All tests
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Test builder</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data.test.status === "published" ? "default" : "secondary"}>
            {data.test.status}
          </Badge>
          {data.test.status !== "published" ? (
            <Button size="sm" onClick={() => doPublish.mutate("published")} disabled={!data.questions.length}>
              Publish
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => doPublish.mutate("draft")}>
              Unpublish
            </Button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Duration (min)</Label>
            <Input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={() => saveMeta.mutate()}>
            Save details
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-border">
        <button
          className={`px-3 py-2 text-sm ${tab === "build" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          onClick={() => setTab("build")}
        >
          Build manually
        </button>
        <button
          className={`px-3 py-2 text-sm ${tab === "import" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          onClick={() => setTab("import")}
        >
          Import from text
        </button>
      </div>

      {tab === "build" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Editor */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              {current.id ? "Edit question" : "New question"}
            </h2>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  value={current.type}
                  onChange={(e) =>
                    setCurrent((c) => ({ ...c, type: e.target.value as QuestionForm["type"] }))
                  }
                >
                  <option value="single_correct">Single correct (MCQ)</option>
                  <option value="integer">Integer / numeric</option>
                </select>
              </div>
              <div>
                <Label>Question (LaTeX: $x^2$ inline)</Label>
                <Textarea
                  rows={4}
                  value={current.question_text}
                  onChange={(e) => setCurrent((c) => ({ ...c, question_text: e.target.value }))}
                />
                {current.question_text && (
                  <div className="mt-2 rounded-md bg-muted/40 p-2 text-sm">
                    <MathText text={current.question_text} />
                  </div>
                )}
              </div>

              {current.type === "single_correct" && (
                <div className="space-y-2">
                  <Label>Options</Label>
                  {(["A", "B", "C", "D"] as const).map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-6 font-mono text-sm">{k}</span>
                      <Input
                        value={current.options[k] ?? ""}
                        onChange={(e) =>
                          setCurrent((c) => ({
                            ...c,
                            options: { ...c.options, [k]: e.target.value },
                          }))
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <Label>Correct answer</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      value={current.correct_answer}
                      onChange={(e) =>
                        setCurrent((c) => ({ ...c, correct_answer: e.target.value }))
                      }
                    >
                      {["A", "B", "C", "D"].map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {current.type === "integer" && (
                <div>
                  <Label>Correct numeric answer</Label>
                  <Input
                    value={current.correct_answer}
                    onChange={(e) =>
                      setCurrent((c) => ({ ...c, correct_answer: e.target.value }))
                    }
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={() => saveQ.mutate(current)} disabled={!current.question_text.trim()}>
                  {current.id ? "Update" : "Add question"}
                </Button>
                {current.id && (
                  <Button variant="outline" onClick={() => setCurrent(emptyQuestion())}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* List */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Questions ({data.questions.length})</h2>
            <div className="space-y-2">
              {data.questions.length === 0 && (
                <p className="text-sm text-muted-foreground">No questions yet.</p>
              )}
              {data.questions.map((q, i) => {
                const qq = q as unknown as {
                  id: string;
                  question_text: string;
                  options: Record<string, string>;
                  correct_answer: string;
                  type: QuestionForm["type"];
                };
                return (
                  <div key={qq.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">Q{i + 1}</div>
                        <div className="mt-1 line-clamp-3 text-sm">
                          <MathText text={qq.question_text} />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Answer: <span className="font-mono">{qq.correct_answer || "—"}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setCurrent({
                              id: qq.id,
                              question_text: qq.question_text,
                              options: qq.options ?? {},
                              correct_answer: qq.correct_answer ?? "",
                              type: (qq.type === "integer" ? "integer" : "single_correct"),
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => del.mutate(qq.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Paste questions</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Format: number then question, options as A) B) C) D), then <code>Answer: C</code>.
            Example:
          </p>
          <pre className="mb-3 overflow-auto rounded-md bg-muted/40 p-3 text-xs">{`1. What is 2+2?
A) 2
B) 3
C) 4
D) 5
Answer: C

2. Speed of light in vacuum (m/s)?
A) 3e8
B) 1e6
Answer: A`}</pre>
          <Textarea
            rows={12}
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            placeholder="Paste your questions here…"
          />
          <div className="mt-3">
            <Button onClick={() => runImport.mutate()} disabled={!importInput.trim() || runImport.isPending}>
              {runImport.isPending ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

function MathText({ text }: { text: string }) {
  // Very light $...$ splitter to render inline math without pulling KaTeX everywhere.
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("$") && p.endsWith("$") ? (
          <InlineMath key={i} math={p.slice(1, -1)} />
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

