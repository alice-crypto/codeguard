import { useServerStatus } from "../api/hooks";
import { CredentialsForm } from "../features/credentials/CredentialsForm";
import { ReadingSizePicker } from "../features/preferences/ReadingSizePicker";
import { ThemePicker } from "../features/preferences/ThemePicker";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import "./pages.css";

export function SettingsPage() {
  const status = useServerStatus();
  return (
    <div className="page">
      <PageHeader title="Réglages" lead="Ton confort de lecture et tes accès aux services." />
      <Card title="Apparence">
        <ThemePicker />
      </Card>
      <Card title="Lecture">
        <ReadingSizePicker />
      </Card>
      <Card title="Identifiants">
        <CredentialsForm />
      </Card>
      {status.data && (
        <p className="settings-version">Serveur codeguard {status.data.version}</p>
      )}
    </div>
  );
}
