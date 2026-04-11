"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  Link as LinkIcon,
  Undo2,
  Redo2,
  Quote,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
  /** Called once with the editor instance so parents can run commands (e.g. insert variable). */
  onReady?: (editor: Editor) => void;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 240,
  onReady,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Digite o conteúdo do e-mail...",
      }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none px-4 py-3",
      },
    },
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div
        className={cn(
          "rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]",
          className,
        )}
        style={{ minHeight }}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] focus-within:ring-2 focus-within:ring-primary/15 focus-within:border-primary/30 transition-all",
        className,
      )}
    >
      <Toolbar editor={editor} />
      <div style={{ minHeight }} className="overflow-y-auto max-h-[60vh]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean) =>
    cn(
      "h-7 w-7 inline-flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-colors",
      active && "bg-primary/10 text-primary",
    );

  const handleLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL do link", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border-light px-2 py-1.5 bg-surface-secondary/60 rounded-t-lg">
      <button
        type="button"
        title="Negrito"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive("bold"))}
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Itálico"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive("italic"))}
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <div className="h-4 w-px bg-border mx-1" />
      <button
        type="button"
        title="Título"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btn(editor.isActive("heading", { level: 2 }))}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Subtítulo"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btn(editor.isActive("heading", { level: 3 }))}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </button>
      <div className="h-4 w-px bg-border mx-1" />
      <button
        type="button"
        title="Lista"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive("bulletList"))}
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Lista numerada"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive("orderedList"))}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Citação"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={btn(editor.isActive("blockquote"))}
      >
        <Quote className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Linha horizontal"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className={btn(false)}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="h-4 w-px bg-border mx-1" />
      <button
        type="button"
        title="Inserir link"
        onClick={handleLink}
        className={btn(editor.isActive("link"))}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          title="Desfazer"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className={cn(btn(false), "disabled:opacity-40")}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Refazer"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className={cn(btn(false), "disabled:opacity-40")}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
