/**
 * Explicit icon map for custom dashboard widgets.
 *
 * Importing `* as LucideIcons from "lucide-react"` forces the entire icon
 * library (~180 KB) into the initial bundle. This map keeps only the icons
 * users can actually pick in the widget builder, enabling tree-shaking.
 */
import {
  Hash,
  DollarSign,
  Briefcase,
  FileText,
  Users,
  TrendingUp,
  TrendingDown,
  Percent,
  BarChart2,
  Activity,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Star,
  type LucideIcon,
} from "lucide-react";

export const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  Hash,
  DollarSign,
  Briefcase,
  FileText,
  Users,
  TrendingUp,
  TrendingDown,
  Percent,
  BarChart2,
  Activity,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Star,
};

/** List of icon names exposed to the user in the widget builder dropdown. */
export const DASHBOARD_ICON_NAMES = Object.keys(DASHBOARD_ICONS);

/** Look up an icon by its name. Falls back to `Hash`. */
export function getDashboardIcon(name: string | undefined): LucideIcon {
  if (!name) return Hash;
  return DASHBOARD_ICONS[name] ?? Hash;
}
