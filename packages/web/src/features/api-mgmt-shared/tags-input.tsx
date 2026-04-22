/**
 * TagsInput — thin pass-through over Mantine's TagsInput.
 *
 * Per project rule B3 (no wrappers), this component does NOT apply styles.
 * It is allowed to exist purely to:
 *   1. Force the component to operate as a controlled input (value/onChange)
 *      over the strongly-typed `string[]` surface.
 *   2. Provide a default placeholder consistent across API-mgmt feature forms.
 *
 * All other Mantine props flow through.
 */
import {
  TagsInput as MantineTagsInput,
  type TagsInputProps as MantineTagsInputProps,
} from '@mantine/core';

export interface TagsInputProps extends Omit<MantineTagsInputProps, 'value' | 'onChange'> {
  values: string[];
  onChange: (next: string[]) => void;
}

export function TagsInput({ values, onChange, placeholder, ...rest }: TagsInputProps) {
  return (
    <MantineTagsInput
      value={values}
      onChange={onChange}
      placeholder={placeholder ?? 'Add tags…'}
      {...rest}
    />
  );
}
