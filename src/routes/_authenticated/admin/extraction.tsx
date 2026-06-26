import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createExtractionJob,
  listExtractionJobs,
  splitExtractionJob,
} from "@/lib/extraction.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/extraction")({
  head: () => ({ meta: [{ title: "PDF → CBT — Admin" }] }),
  component: ExtractionPage,
});

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-muted text-muted-foreground",
  splitting: "bg-accent text-accent-foreground",
  extracting: "bg-accent text-accent-foreground",
  validating: "bg-accent text-accent-foreground",
  needs_review: "bg-warning/20 text-warning-foreground border border-warning/40",
  approved: "bg-success/20 text-success border border-success/40",
  published: "bg-success/20 text-success border border-success/40",
  failed: "bg-destructive/20 text-destructive border border-destructive/40",
};

function ExtractionPage() {
  const { user } = (Route.useRouteContext() as unknown) as { user: { id: string } };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listExtractionJobs);
  const split = useServerFn(splitExtractionJob);

  const jobs = useQuery({
    queryKey: ["extraction-jobs"],
    queryFn: () => list(),
    refetchInterval: (q) => {
      const active = (q.state.data ?? []).some((j) =>
        ["splitting", "extracting", "validating"].includes(j.status),
      );
      return active ? 2000 : false;
    },
  });

  const startMut = useMutation({
    mutationFn: async (jobId: string) => split({ data: { jobId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extraction-jobs"] }),
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Pipeline</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">PDF → CBT</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload a question paper PDF. We split it into 2-page batches, extract with Gemini, validate with Groq, and let you review every question before publishing.
          </p>
        </div>
      </div>

      <UploadCard
        userId={user.id}
        onCreated={async (jobId) => {
          await qc.invalidateQueries({ queryKey: ["extraction-jobs"] });
          toast.message("Splitting PDF…");
          try {
            const r = await startMut.mutateAsync(jobId);
            toast.success(`Split into ${r.batchCount} batches (${r.pageCount} pages) — opening job`);
            navigate({ to: "/admin/extraction/$jobId", params: { jobId } });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />


      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">Recent jobs</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Title</th>
                <th className="px-4 py-2 text-left font-medium">Exam</th>
                <th className="px-4 py-2 text-left font-medium">Pages</th>
                <th className="px-4 py-2 text-left font-medium">Expected</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Score</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {jobs.isLoading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!jobs.isLoading && (jobs.data ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No jobs yet. Upload a PDF above.</td></tr>
              )}
              {(jobs.data ?? []).map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-3">
                    <Link
                      to="/admin/extraction/$jobId"
                      params={{ jobId: j.id }}
                      className="font-medium hover:underline"
                    >
                      {j.title ?? j.original_filename}
                    </Link>
                    <div className="text-xs text-muted-foreground">{j.original_filename}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{j.exam ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{j.page_count ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{j.expected_question_count ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_STYLES[j.status] ?? "bg-muted"}>{j.status}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{j.extraction_score ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to="/admin/extraction/$jobId" params={{ jobId: j.id }}>
                      <Button size="sm" variant="ghost">Open →</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function UploadCard({ userId, onCreated }: { userId: string; onCreated: (jobId: string) => void }) {
  const createJob = useServerFn(createExtractionJob);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [exam, setExam] = useState<"jee_main" | "jee_advanced" | "neet">("jee_main");
  const [expected, setExpected] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const onUpload = async () => {
    if (!file) return toast.error("Pick a PDF first");
    if (!title.trim()) return toast.error("Add a title for this test");
    if (file.size > 30 * 1024 * 1024) return toast.error("PDFs must be under 30 MB");
    setBusy(true);
    try {
      const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const up = await supabase.storage.from("pdf-uploads").upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (up.error) throw new Error(up.error.message);

      const expectedNum = expected ? Math.max(1, parseInt(expected, 10)) : null;
      const { jobId } = await createJob({
        data: {
          storagePath: path,
          originalFilename: file.name,
          title: title.trim(),
          exam,
          expectedQuestionCount: expectedNum,
        },
      });
      setFile(null);
      setTitle("");
      setExpected("");
      toast.success("Job created");
      onCreated(jobId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-6">
      <h2 className="text-base font-semibold">Upload paper</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Tip: include only the question paper. If your PDF also contains an answer key or solutions, the pipeline will skip those — but a clean question-only PDF is most reliable.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_180px_160px_160px_auto] sm:items-end">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="JEE Main 2024 Shift 1" />
        </div>
        <div>
          <Label>Exam</Label>
          <Select value={exam} onValueChange={(v) => setExam(v as never)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="jee_main">JEE Main</SelectItem>
              <SelectItem value="jee_advanced">JEE Advanced</SelectItem>
              <SelectItem value="neet">NEET</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="expected">Expected Qs</Label>
          <Input id="expected" inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value.replace(/\D/g, ""))} placeholder="75" />
        </div>
        <div>
          <Label htmlFor="file">PDF</Label>
          <Input id="file" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Button onClick={onUpload} disabled={busy}>{busy ? "Uploading…" : "Start"}</Button>
      </div>
    </div>
  );
}
