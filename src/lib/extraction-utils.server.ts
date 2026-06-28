import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type AuthedContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export function errorStack(error: unknown) {
  if (error instanceof Error) return error.stack ?? error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function logExtractionError(stage: string, jobId: string, error: unknown) {
  console.error(`[pdf-extraction:${stage}] job=${jobId}\n${errorStack(error)}`);
}

export async function assertAdmin(ctx: AuthedContext) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export async function auditExtraction(
  supabase: SupabaseClient<Database>,
  jobId: string,
  actor: string | null,
  action: string,
  payload: Json = {},
) {
  const { error } = await supabase.from("extraction_audit_log").insert({
    job_id: jobId,
    actor,
    action,
    payload,
  });
  if (error) console.error(`[pdf-extraction:audit] job=${jobId} ${error.message}`);
}

export async function recoverStuckJobs(
  ctx: AuthedContext,
  options: { timeoutMinutes: number },
) {
  const timeoutMinutes = Math.max(2, Math.min(120, options.timeoutMinutes));
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();
  const { data: jobs, error } = await ctx.supabase
    .from("extraction_jobs")
    .select("id, status, updated_at")
    .in("status", ["splitting", "extracting", "validating"])
    .lt("updated_at", cutoff);
  if (error) throw new Error(error.message);

  const recovered: { jobId: string; status: string; action: string }[] = [];
  for (const job of jobs ?? []) {
    if (job.status === "splitting") {
      const reason = `Split timed out after ${timeoutMinutes} minutes. Retry failed step to split again.`;
      await ctx.supabase.from("extraction_jobs").update({ status: "failed", last_error: reason }).eq("id", job.id);
      await auditExtraction(ctx.supabase, job.id, ctx.userId, "recovery.failed_splitting", { reason, timeoutMinutes });
      recovered.push({ jobId: job.id, status: job.status, action: "failed" });
      continue;
    }

    if (job.status === "extracting") {
      const { data: batches } = await ctx.supabase
        .from("extraction_batches")
        .select("id, status")
        .eq("job_id", job.id);
      const pendingOrRunning = (batches ?? []).filter((b) => b.status === "pending" || b.status === "running");
      const failed = (batches ?? []).filter((b) => b.status === "failed");

      if (pendingOrRunning.length > 0) {
        const ids = pendingOrRunning.map((b) => b.id);
        await ctx.supabase
          .from("extraction_batches")
          .update({ status: "pending", last_error: null })
          .in("id", ids);
        await ctx.supabase.from("extraction_jobs").update({ status: "extracting", last_error: null }).eq("id", job.id);
        await auditExtraction(ctx.supabase, job.id, ctx.userId, "recovery.resumed_extracting", {
          resetBatches: ids.length,
          timeoutMinutes,
        });
        recovered.push({ jobId: job.id, status: job.status, action: "resumed" });
      } else if (failed.length > 0) {
        const reason = `${failed.length} extraction batch${failed.length === 1 ? "" : "es"} failed. Retry failed step to re-run only failed batches.`;
        await ctx.supabase.from("extraction_jobs").update({ status: "failed", last_error: reason }).eq("id", job.id);
        await auditExtraction(ctx.supabase, job.id, ctx.userId, "recovery.failed_extracting", { reason, timeoutMinutes });
        recovered.push({ jobId: job.id, status: job.status, action: "failed" });
      } else {
        const reason = "Extraction stopped before validation started. Retry failed step to validate the extracted questions.";
        await ctx.supabase.from("extraction_jobs").update({ status: "failed", last_error: reason }).eq("id", job.id);
        await auditExtraction(ctx.supabase, job.id, ctx.userId, "recovery.needs_validation_retry", { reason, timeoutMinutes });
        recovered.push({ jobId: job.id, status: job.status, action: "failed" });
      }
      continue;
    }

    if (job.status === "validating") {
      const reason = `Validation timed out after ${timeoutMinutes} minutes. Retry failed step to run validation again.`;
      await ctx.supabase.from("extraction_jobs").update({ status: "failed", last_error: reason }).eq("id", job.id);
      await auditExtraction(ctx.supabase, job.id, ctx.userId, "recovery.failed_validating", { reason, timeoutMinutes });
      recovered.push({ jobId: job.id, status: job.status, action: "failed" });
    }
  }

  return { recovered, checkedAt: new Date().toISOString() };
}