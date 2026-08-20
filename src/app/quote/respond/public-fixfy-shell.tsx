"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export const FIXFY_NAVY = "#020040";
export const FIXFY_ORANGE = "#ED4B00";
export const FIXFY_MUTED = "#6B6B85";
export const FIXFY_BORDER = "#E4E4EC";
export const FIXFY_BG = "#F7F7FB";

type ShellSize = "md" | "lg";

export function FixfyPublicShell({
  children,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  size?: ShellSize;
  className?: string;
}) {
  const maxW = size === "lg" ? "max-w-lg" : "max-w-md";

  /**
   * Estas páginas são claras sempre, mesmo com o celular do parceiro no escuro.
   *
   * O `<html>` carrega a classe `dark` do tema do OS, e as páginas públicas
   * herdavam: o parceiro abria o link e via o formulário inteiro em preto, com
   * o "No" de cada pergunta pintado de navy sobre navy. É página de marca, com
   * paleta fixa (`FIXFY_BG`, `FIXFY_NAVY`), e a metade dela que usa classe
   * Tailwind virava do avesso enquanto a outra metade, que usa `style`, não.
   *
   * O estado anterior volta ao desmontar, porque o mesmo componente aparece
   * dentro do OS logado, onde o tema escuro é escolha de quem está lá.
   */
  useEffect(() => {
    const el = document.documentElement;
    const eraEscuro = el.classList.contains("dark");
    el.classList.remove("dark");
    const colorSchemeAntes = el.style.colorScheme;
    el.style.colorScheme = "light";
    return () => {
      if (eraEscuro) el.classList.add("dark");
      el.style.colorScheme = colorSchemeAntes;
    };
  }, []);

  /**
   * A PÁGINA rola. Sempre, em qualquer tela.
   *
   * O cartão nasceu com `max-h` e `overflow-hidden`, o que é bonito para um
   * cartão curto e é uma armadilha para um formulário longo: o relatório de
   * limpeza tem treze blocos de foto e passa de 3000px depois que o parceiro
   * anexa. Preso num quadro com teto, ele CORTA — em 20/08/2026 o dono mandou
   * o print com o texto interrompido no meio de "Include: oven, hob..." e um
   * vazio embaixo.
   *
   * Tentei duas vezes acertar a largura em que o teto podia valer (`sm`, depois
   * `lg`) e as duas vezes sobrou um tamanho de janela onde ele cortava. A
   * lição é que o teto não tem largura certa: formulário que cresce com o
   * conteúdo não pode ter altura fixa, ponto.
   *
   * O que sobra do cartão é o que era bom nele: a largura máxima, o canto
   * arredondado e a sombra numa tela grande. Nada disso corta nada.
   */
  return (
    <div
      className={`flex min-h-screen items-stretch justify-center p-0 lg:items-start lg:p-6 ${className}`}
      style={{ background: FIXFY_BG, colorScheme: "light" }}
    >
      <div
        className={`flex w-full ${maxW} flex-col rounded-none border-0 bg-white lg:rounded-2xl lg:border lg:shadow-[0_8px_30px_rgba(2,0,64,0.08)]`}
        style={{ borderColor: FIXFY_BORDER }}
      >
        {children}
      </div>
    </div>
  );
}

export function FixfyPublicHeader({ eyebrow }: { eyebrow?: string }) {
  return (
    <div style={{ background: FIXFY_NAVY }}>
      <div className="flex flex-col items-center justify-center px-6 py-5">
        {eyebrow ? (
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: FIXFY_ORANGE }}
          >
            {eyebrow}
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logos/fixfy-email-header.png"
          alt="Fixfy"
          width={132}
          height={20}
          className="h-auto w-[108px] max-w-[36%] sm:w-[132px]"
        />
      </div>
      <div className="h-1" style={{ background: "linear-gradient(90deg,#ED4B00 0%,#FF7A29 100%)" }} />
    </div>
  );
}

type StatusVariant = "success" | "warning" | "error" | "info";

const STATUS_STYLES: Record<
  StatusVariant,
  { icon: typeof CheckCircle2; iconBg: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, iconBg: "#E4F5EE", iconColor: "#0F6E56" },
  warning: { icon: AlertTriangle, iconBg: "#FFF1EB", iconColor: "#ED4B00" },
  error:   { icon: AlertTriangle, iconBg: "#FBE3E7", iconColor: "#C8102E" },
  info:    { icon: Info, iconBg: "#E8F4FD", iconColor: "#0B5FFF" },
};

export function FixfyPublicStatus({
  variant,
  title,
  message,
  badge,
  footer,
}: {
  variant: StatusVariant;
  title: string;
  message: ReactNode;
  badge?: string;
  footer?: ReactNode;
}) {
  const s = STATUS_STYLES[variant];
  const Icon = s.icon;
  return (
    <FixfyPublicShell>
      <FixfyPublicHeader eyebrow="Fixfy partner" />
      <div className="flex flex-1 flex-col px-6 py-8 text-center sm:px-8">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: s.iconBg, color: s.iconColor }}
        >
          <Icon className="h-7 w-7" strokeWidth={2} />
        </div>
        {badge ? (
          <span
            className="mx-auto mt-4 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ background: FIXFY_BG, color: FIXFY_NAVY, border: `1px solid ${FIXFY_BORDER}` }}
          >
            {badge}
          </span>
        ) : null}
        <h1 className="mt-4 text-[20px] font-bold leading-tight" style={{ color: FIXFY_NAVY }}>
          {title}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: FIXFY_MUTED }}>
          {message}
        </p>
        {footer ? <div className="mt-6">{footer}</div> : null}
        <p className="mt-auto pt-8 text-[11px] leading-relaxed" style={{ color: FIXFY_MUTED }}>
          Need help?{" "}
          <a href="mailto:support@getfixfy.com" className="font-semibold underline" style={{ color: FIXFY_ORANGE }}>
            support@getfixfy.com
          </a>
        </p>
      </div>
    </FixfyPublicShell>
  );
}

export function FixfyPublicLoading({ message = "Loading…" }: { message?: string }) {
  return (
    <FixfyPublicShell>
      <FixfyPublicHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: FIXFY_ORANGE }} />
        <p className="text-[14px] font-medium" style={{ color: FIXFY_MUTED }}>{message}</p>
      </div>
    </FixfyPublicShell>
  );
}

/** Scrollable body below the shared header — used by report/bid forms. */
/**
 * O corpo do cartão. NÃO rola por dentro: quem rola é a página.
 *
 * O nome ficou por causa dos lugares que já o importam, mas o `overflow` saiu:
 * rolador dentro de rolador é o que prendia o formulário e cortava o fim dele.
 */
export function FixfyPublicScrollBody({ children }: { children: ReactNode }) {
  return <div className="flex-1">{children}</div>;
}
