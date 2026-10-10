import { useTranslation } from 'react-i18next';

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import { useModels } from '@/features/models/use-models';

/**
 * Picks the model of a chat. The value is always what the chat stores: if that model is not in the list any more
 * (connection down, model removed) it still shows under its id, with a warning, instead of jumping to another model.
 */
export function ModelPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const models = useModels();
  const available = models.data?.models ?? [];
  const selected = available.find((model) => model.id === value);
  const missing = models.isSuccess && selected === undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor="chat-model">{t('chats.model.label')}</Label>
        <NativeSelect
          id="chat-model"
          value={value}
          disabled={disabled || models.isPending}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {(missing || !models.isSuccess) && (
            <NativeSelectOption value={value}>{value}</NativeSelectOption>
          )}
          {available.map((model) => (
            <NativeSelectOption key={model.id} value={model.id}>
              {model.name} ({model.providerName})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {selected !== undefined && (
        <p className="text-muted-foreground text-xs">
          {t('chats.model.provider', { provider: selected.providerName })}
        </p>
      )}
      {missing && (
        <p role="alert" className="text-destructive text-xs">
          {t('chats.model.unavailable')}
        </p>
      )}
      {models.isPending && (
        <p className="text-muted-foreground text-xs">{t('chats.model.loading')}</p>
      )}
    </div>
  );
}
