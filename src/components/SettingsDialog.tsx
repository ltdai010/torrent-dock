import { Captions, RadioTower, X } from "lucide-react";
import type { LanguageOption } from "../domain/appTypes";
import { AppIconButton, AppPageHeader, AppSelect, AppSlider, AppTextField } from "./AppControls";
import { Button, Card, Dialog, Flex, Grid, Heading, Text } from "./ui";
import "./SettingsDialog.css";

type SettingsDialogProps = {
  subSourceApiKey: string;
  subSourceLanguage: string;
  subSourceLanguageOptions: LanguageOption[];
  openSubtitlesUsername: string;
  openSubtitlesPassword: string;
  openSubtitlesLanguage: string;
  openSubtitlesLanguageOptions: LanguageOption[];
  subtitleTextScale: number;
  onCloseSettings: () => void;
  onSubSourceApiKeyChange: (value: string) => void;
  onSubSourceLanguageChange: (value: string) => void;
  onOpenSubtitlesUsernameChange: (value: string) => void;
  onOpenSubtitlesPasswordChange: (value: string) => void;
  onOpenSubtitlesLanguageChange: (value: string) => void;
  onSubtitleTextScaleChange: (value: number) => void;
};

export function SettingsDialog({
  subSourceApiKey,
  subSourceLanguage,
  subSourceLanguageOptions,
  openSubtitlesUsername,
  openSubtitlesPassword,
  openSubtitlesLanguage,
  openSubtitlesLanguageOptions,
  subtitleTextScale,
  onCloseSettings,
  onSubSourceApiKeyChange,
  onSubSourceLanguageChange,
  onOpenSubtitlesUsernameChange,
  onOpenSubtitlesPasswordChange,
  onOpenSubtitlesLanguageChange,
  onSubtitleTextScaleChange
}: SettingsDialogProps) {
  return (
    <Dialog.Root open onOpenChange={(open) => {
      if (!open) {
        onCloseSettings();
      }
    }}>
      <Dialog.Content
        size="3"
        maxWidth="var(--dialog-max-width)"
        maxHeight="min(var(--dialog-max-height), calc(100dvh - var(--space-12)))"
        aria-label="Settings"
      >
        <Dialog.Title className="visually-hidden">Settings</Dialog.Title>
        <Dialog.Description className="visually-hidden">
          Subtitle search credentials and defaults.
        </Dialog.Description>
        <AppPageHeader
          title="Settings"
          description="Subtitle search credentials and defaults."
          actions={
            <AppIconButton type="button" variant="ghost" color="gray" onClick={onCloseSettings} label="Close settings">
              <X size={20} aria-hidden="true" />
            </AppIconButton>
          }
        />

        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
          <Card aria-labelledby="subtitle-settings-title">
            <Flex direction="column" gap="4">
              <Flex align="start" gap="2">
              <Captions size={18} aria-hidden="true" />
              <Flex direction="column" gap="1">
                <Heading as="h3" size="3" id="subtitle-settings-title">Subtitle search</Heading>
                <Text as="span" size="1" color="gray" weight="bold">Saved locally</Text>
              </Flex>
              </Flex>

              <Flex direction="column" gap="3">
              <AppSlider
                label="Subtitle text size"
                min={0.75}
                max={1.7}
                step={0.05}
                value={subtitleTextScale}
                valueLabel={`${Math.round(subtitleTextScale * 100)}%`}
                onChange={onSubtitleTextScaleChange}
              />
              <Button type="button" variant="surface" color="gray" onClick={() => onSubtitleTextScaleChange(1)}>
                Reset
              </Button>
              </Flex>
            </Flex>
          </Card>

          <Card aria-labelledby="subsource-settings-title">
            <Flex direction="column" gap="4">
              <Flex align="start" gap="2">
              <RadioTower size={18} aria-hidden="true" />
              <Flex direction="column" gap="1">
                <Heading as="h3" size="3" id="subsource-settings-title">SubSource</Heading>
                <Text as="span" size="1" color="gray" weight="bold">{subSourceApiKey.trim() ? "API key saved" : "API key missing"}</Text>
              </Flex>
              </Flex>

              <Flex direction="column" gap="3">
              <AppTextField
                label="API key"
                type="password"
                value={subSourceApiKey}
                onChange={onSubSourceApiKeyChange}
                autoComplete="off"
                spellCheck={false}
              />
              <AppSelect
                label="Search language"
                value={subSourceLanguage}
                options={subSourceLanguageOptions}
                onChange={onSubSourceLanguageChange}
              />
              </Flex>
            </Flex>
          </Card>

          <Card aria-labelledby="opensubtitles-settings-title">
            <Flex direction="column" gap="4">
              <Flex align="start" gap="2">
              <RadioTower size={18} aria-hidden="true" />
              <Flex direction="column" gap="1">
                <Heading as="h3" size="3" id="opensubtitles-settings-title">OpenSubtitles.org</Heading>
                <Text as="span" size="1" color="gray" weight="bold">{openSubtitlesUsername.trim() && openSubtitlesPassword ? "Account saved" : "Account missing"}</Text>
              </Flex>
              </Flex>

              <Flex direction="column" gap="3">
              <AppTextField
                label="Username"
                value={openSubtitlesUsername}
                onChange={onOpenSubtitlesUsernameChange}
                autoComplete="username"
                spellCheck={false}
              />
              <AppTextField
                label="Password"
                type="password"
                value={openSubtitlesPassword}
                onChange={onOpenSubtitlesPasswordChange}
                autoComplete="current-password"
                spellCheck={false}
              />
              <AppSelect
                label="Search language"
                value={openSubtitlesLanguage}
                options={openSubtitlesLanguageOptions}
                onChange={onOpenSubtitlesLanguageChange}
              />
              </Flex>
            </Flex>
          </Card>
        </Grid>
      </Dialog.Content>
    </Dialog.Root>
  );
}
