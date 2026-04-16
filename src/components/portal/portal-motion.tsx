"use client";

import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Reusable motion primitives for the portal. Kept as client components so
 * server-rendered pages can compose them without paying the "mark as
 * client" cost on every leaf node.
 *
 * Design intent:
 *   - Default motion is subtle (no parallax, no dramatic scales). The
 *     portal is a B2B tool — it should feel alive but not distract.
 *   - Consistent timing curve (cubic-bezier(0.25, 0.46, 0.45, 0.94)) so
 *     every transition has the same "character".
 *   - All animations respect `prefers-reduced-motion` at the OS level
 *     via framer-motion's built-in handling.
 */

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.08 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE },
  },
};

const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: EASE },
  },
};

const cardHoverVariants = {
  rest: { y: 0, boxShadow: "0 1px 2px 0 rgba(0,0,0,0.04)" },
  hover: { y: -2, boxShadow: "0 10px 25px -10px rgba(0,0,0,0.12)", transition: { duration: 0.2 } },
};

/**
 * Wraps a portal page so the full content fades up on mount. Use once
 * per page, directly inside the page component.
 */
export function PortalPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={pageVariants}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggers its children in on mount. Pair with PortalListItem.
 */
export function PortalStagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Individual item in a staggered list. Receives its own variant from
 * the parent PortalStagger.
 */
export function PortalListItem({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  const MotionTag =
    Tag === "li"
      ? motion.li
      : Tag === "article"
        ? motion.article
        : motion.div;
  return (
    <MotionTag variants={itemVariants} className={className}>
      {children}
    </MotionTag>
  );
}

/**
 * Interactive card with subtle lift on hover. Pass `href` to wrap with
 * a link; otherwise it's a plain article. Add `selected` so the current
 * item pops slightly.
 */
export function PortalCard({
  children,
  href,
  className = "",
  interactive = true,
  selected = false,
}: {
  children: ReactNode;
  href?: string;
  className?: string;
  interactive?: boolean;
  selected?: boolean;
}) {
  const base = `rounded-2xl border bg-card transition-colors ${
    selected ? "border-primary/40 ring-2 ring-primary/10" : "border-border hover:border-border-light"
  } ${className}`;

  if (interactive && href) {
    return (
      <motion.a
        href={href}
        className={`block ${base}`}
        variants={itemVariants}
        whileHover="hover"
        initial="rest"
        animate="rest"
      >
        <motion.div variants={cardHoverVariants} className="rounded-2xl">
          {children}
        </motion.div>
      </motion.a>
    );
  }

  return (
    <motion.article variants={itemVariants} className={base}>
      {children}
    </motion.article>
  );
}
