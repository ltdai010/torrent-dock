import type { ClipboardEvent, ComponentProps, ReactNode } from "react";
import { Button, Flex, Heading, IconButton, Select, Slider, Text, TextField } from "./ui";
import "./AppControls.css";

type AppTextFieldProps = {
  id?: string;
  label: ReactNode;
  type?: "text" | "password";
  value: string;
  onChange: (value: string) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  spellCheck?: boolean;
};

type AppSelectProps = {
  label: ReactNode;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

type AppSliderProps = {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  valueLabel?: ReactNode;
};

type AppPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
};

type AppSidebarItem = {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
};

type AppTopBarProps = {
  title: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
};

type AppHeaderSearchProps = {
  id?: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  actionLabel: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  secondaryAction?: ReactNode;
};

type AppIconButtonProps = Omit<ComponentProps<typeof IconButton>, "aria-label" | "children"> & {
  label: string;
  children: ReactNode;
};

export function AppTextField({
  id,
  label,
  type = "text",
  value,
  onChange,
  onPaste,
  autoComplete,
  spellCheck
}: AppTextFieldProps) {
  return (
    <Flex asChild direction="column" gap="1">
    <label>
      <Text as="span" size="2" weight="bold" color="gray">{label}</Text>
      <TextField.Root
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
    </label>
    </Flex>
  );
}

export function AppTopBar({ title, search, actions }: AppTopBarProps) {
  return (
    <header className="topbar">
      <Heading as="h1" size="5" weight="bold">{title}</Heading>
      {search ? <div className="topbar-search">{search}</div> : null}
      {actions ? <Flex align="center" justify="end" gap="2" wrap="wrap">{actions}</Flex> : null}
    </header>
  );
}

export function AppSidebar({ items }: { items: AppSidebarItem[] }) {
  return (
    <nav className="app-sidebar" aria-label="Primary">
      {items.map((item) => (
        <button
          type="button"
          className={item.active ? "app-sidebar-item active" : "app-sidebar-item"}
          aria-current={item.active ? "page" : undefined}
          onClick={item.onClick}
          key={item.label}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function AppHeaderSearch({
  id,
  label,
  value,
  onChange,
  onPaste,
  onSubmit,
  actionLabel,
  disabled,
  icon,
  secondaryAction
}: AppHeaderSearchProps) {
  return (
    <form
      className="app-header-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Text as="label" size="2" weight="bold" className="visually-hidden" htmlFor={id}>{label}</Text>
      <TextField.Root
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        spellCheck={false}
        autoComplete="off"
        className="app-header-search-input"
      />
      <Button type="submit" color="red" disabled={disabled} className="app-header-search-button" aria-label={String(actionLabel)}>
        {icon}
      </Button>
      {secondaryAction ? <div className="app-header-search-secondary">{secondaryAction}</div> : null}
    </form>
  );
}

export function AppSelect({ label, value, options, onChange }: AppSelectProps) {
  return (
    <Flex asChild direction="column" gap="1">
    <label>
      <Text as="span" size="2" weight="bold" color="gray">{label}</Text>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger />
        <Select.Content>
          {options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </label>
    </Flex>
  );
}

export function AppSlider({ label, value, min, max, step, onChange, valueLabel }: AppSliderProps) {
  return (
    <Flex align="center" gap="2">
      <Text as="span" size="2" weight="bold" color="gray">{label}</Text>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([nextValue]) => onChange(nextValue)} />
      {valueLabel ? <Text as="span" size="2" weight="bold">{valueLabel}</Text> : null}
    </Flex>
  );
}

export function AppPageHeader({ title, description, leading, actions }: AppPageHeaderProps) {
  return (
    <Flex align="start" justify="between" gap="3" wrap="wrap">
      <Flex align="start" gap="3">
        {leading}
        <div>
          <Heading as="h2" size="5">{title}</Heading>
          {description ? <Text as="p" size="2" color="gray">{description}</Text> : null}
        </div>
      </Flex>
      {actions ? <Flex gap="2" wrap="wrap">{actions}</Flex> : null}
    </Flex>
  );
}

export function AppIconButton({ label, children, ...props }: AppIconButtonProps) {
  return (
    <IconButton aria-label={label} title={label} {...props}>
      {children}
    </IconButton>
  );
}
