import { SettingsTabs } from '@/components/settings/settings-tabs';
import { PageHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getTranslations();

  return (
    <>
      <PageHeader title={t.settings.title} />
      <SettingsTabs />
      <div className="mt-5">{children}</div>
    </>
  );
}
