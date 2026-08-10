import { AdminTabs } from '@/components/admin/admin-tabs';
import { PageHeader } from '@/components/ui/sheet';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';

/**
 * Administration shell.
 *
 * `requireAdmin` runs here, and again inside every page, and again inside every
 * /api/admin handler. That is not redundancy for its own sake — a layout guard
 * protects rendering, not data, and the API is reachable without ever loading
 * this layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { t } = await getTranslations();

  return (
    <>
      <PageHeader title={t.admin.title} />
      <AdminTabs />
      <div className="mt-5">{children}</div>
    </>
  );
}
