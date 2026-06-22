import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

type Props = { math: string; className?: string };

function render(math: string, displayMode: boolean) {
  try {
    return katex.renderToString(math, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return math;
  }
}

export function InlineMath({ math, className }: Props) {
  const html = useMemo(() => render(math ?? "", false), [math]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function BlockMath({ math, className }: Props) {
  const html = useMemo(() => render(math ?? "", true), [math]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
