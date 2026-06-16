"use client";

import { useEffect } from "react";
import {
  useEditor,
  EditorContent,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle, Color } from "@tiptap/extension-text-style";

/* Preset highlight (background) colors — the centrepiece feature. */
const HIGHLIGHTS: { label: string; color: string }[] = [
  { label: "Yellow", color: "#fff3a3" },
  { label: "Green", color: "#c7f0d2" },
  { label: "Blue", color: "#cfe8ff" },
  { label: "Pink", color: "#ffd6e7" },
  { label: "Orange", color: "#ffe0b3" },
  { label: "Purple", color: "#e7d9ff" },
];

const TEXT_COLORS = ["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#ca8a04"];

type Props = {
  value: string;
  onChange: (html: string) => void;
};

export default function Editor({ value, onChange }: Props) {
  const editor = useEditor({
    immediatelyRender: false, // required for Next SSR
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          "prose-email min-h-[320px] px-4 py-3 focus:outline-none text-[15px] leading-relaxed",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sync external value in (e.g. when a template is loaded / form reset).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="card min-h-[380px]" />
    );
  }

  return (
    <div className="card overflow-hidden">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                            */
/* ------------------------------------------------------------------ */

function Toolbar({ editor }: { editor: TiptapEditor }) {
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line/60 bg-paper/60 px-2 py-1.5">
      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <span className="font-bold">B</span>
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <span className="italic">I</span>
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline"
      >
        <span className="underline">U</span>
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <span className="line-through">S</span>
      </Btn>

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading"
      >
        H
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        •
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        1.
      </Btn>
      <Btn onClick={setLink} active={editor.isActive("link")} title="Link">
        🔗
      </Btn>

      <Divider />

      {/* === Highlight (background colour) — the main feature === */}
      <span className="px-1 text-[11px] font-medium text-ink-faint">
        Highlight
      </span>
      {HIGHLIGHTS.map((h) => (
        <button
          key={h.color}
          type="button"
          title={`Highlight: ${h.label}`}
          onClick={() =>
            editor.chain().focus().toggleHighlight({ color: h.color }).run()
          }
          className="h-6 w-6 rounded-md shadow-[inset_0_0_0_1px_rgba(35,32,27,0.12)] transition hover:scale-110 hover:shadow-[inset_0_0_0_1px_rgba(35,32,27,0.35)]"
          style={{ backgroundColor: h.color }}
        />
      ))}
      <label
        title="Custom highlight colour"
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-ink-muted transition hover:border-ink/40 hover:text-ink"
      >
        +
        <input
          type="color"
          className="sr-only"
          onChange={(e) =>
            editor.chain().focus().setHighlight({ color: e.target.value }).run()
          }
        />
      </label>
      <Btn
        onClick={() => editor.chain().focus().unsetHighlight().run()}
        title="Remove highlight"
      >
        ⌫
      </Btn>

      <Divider />

      <span className="px-1 text-[11px] font-medium text-ink-faint">Text</span>
      {TEXT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title="Text colour"
          onClick={() => editor.chain().focus().setColor(c).run()}
          className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1px_rgba(35,32,27,0.12)] transition hover:scale-110"
          style={{ backgroundColor: c }}
        />
      ))}

      <Divider />

      <Btn
        onClick={() =>
          editor.chain().focus().unsetAllMarks().clearNodes().run()
        }
        title="Clear formatting"
      >
        Clear
      </Btn>
    </div>
  );
}

function Btn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[13px] transition ${
        active
          ? "bg-accent/15 text-accent"
          : "text-ink-muted hover:bg-line/40 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line/80" />;
}
