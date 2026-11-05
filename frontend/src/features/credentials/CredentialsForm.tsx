import { useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { useSaveSecrets, useServerStatus } from "../../api/hooks";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/inputs";
import { useToast } from "../../ui/toast";
import { CredentialStatus } from "./CredentialStatus";
import "./CredentialsForm.css";

export function CredentialsForm() {
  const status = useServerStatus();
  const save = useSaveSecrets();
  const notify = useToast();
  const [anthropic, setAnthropic] = useState("");
  const [github, setGithub] = useState("");
  const credentials = status.data?.credentials;
  const hasSessionKey = credentials?.anthropic === "session" || credentials?.github === "session";

  function submit(event: FormEvent) {
    event.preventDefault();
    const secrets = {
      ...(anthropic && { anthropic_key: anthropic }),
      ...(github && { github_token: github }),
    };
    save.mutate(secrets, {
      onSuccess: () => {
        setAnthropic("");
        setGithub("");
        notify("Clés enregistrées pour cette session");
      },
    });
  }

  return (
    <form className="credentials-form" onSubmit={submit} autoComplete="off">
      <div className="credentials-form__status">
        <CredentialStatus name="Claude" source={credentials?.anthropic ?? null} />
        <CredentialStatus name="GitHub" source={credentials?.github ?? null} />
      </div>
      <p>
        Les clés saisies ici restent en mémoire jusqu'à l'arrêt du serveur et ne sont jamais écrites
        sur le disque. Laisse un champ vide pour garder sa valeur actuelle.
      </p>
      <Field label="Clé API Anthropic">
        {(control) => (
          <TextInput
            {...control}
            type="password"
            value={anthropic}
            onChange={(event) => setAnthropic(event.target.value)}
          />
        )}
      </Field>
      <Field label="Token GitHub" hint="Nécessaire pour les pull requests.">
        {(control) => (
          <TextInput
            {...control}
            type="password"
            value={github}
            onChange={(event) => setGithub(event.target.value)}
          />
        )}
      </Field>
      {save.error instanceof ApiError && <Banner tone="error">{save.error.message}</Banner>}
      <div className="credentials-form__actions">
        <Button type="submit" variant="primary" disabled={save.isPending || (!anthropic && !github)}>
          Enregistrer
        </Button>
        {hasSessionKey && (
          <Button
            variant="quiet"
            onClick={() =>
              save.mutate(
                { anthropic_key: "", github_token: "" },
                { onSuccess: () => notify("Clés de session oubliées") },
              )
            }
          >
            Oublier les clés de session
          </Button>
        )}
      </div>
    </form>
  );
}
