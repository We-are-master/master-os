import { redirect } from "next/navigation";

/**
 * Short, WhatsApp-friendly entry point for partner self-service uploads.
 * `${origin}/p/{slug}` → forwards to the full upload page using the slug as the token.
 *
 * The public API routes accept either the legacy HMAC token or the new slug, so all
 * we need to do here is hand the slug straight to /partner-upload.
 */
export default async function PartnerShortLinkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/partner-upload?token=${encodeURIComponent(slug)}`);
}
