import {
  formErrors,
  McpGatewayWithoutSensitiveData,
} from '@activepieces/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from 'i18next';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const AUTH_TYPES = ['NONE', 'BEARER', 'API_KEY', 'HEADER'] as const;

const FormSchema = z
  .object({
    name: z.string().min(1, formErrors.required).max(120),
    url: z.string().url('McpGateway.invalidUrl'),
    description: z.string().max(500).optional(),
    authType: z.enum(AUTH_TYPES),
    token: z.string().optional(),
    headerName: z.string().optional(),
    headerValue: z.string().optional(),
    apiKey: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.authType === 'BEARER' && !data.token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token'],
        message: formErrors.required,
      });
    }
    if (data.authType === 'API_KEY') {
      if (!data.headerName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerName'],
          message: formErrors.required,
        });
      }
      if (!data.apiKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['apiKey'],
          message: formErrors.required,
        });
      }
    }
    if (data.authType === 'HEADER') {
      if (!data.headerName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerName'],
          message: formErrors.required,
        });
      }
      if (!data.headerValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerValue'],
          message: formErrors.required,
        });
      }
    }
  });

type FormValues = z.infer<typeof FormSchema>;

type McpGatewayFormProps = {
  mode: 'create' | 'edit';
  existing?: McpGatewayWithoutSensitiveData;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (values: FormValues) => void;
  serverError?: string;
};

export const MCP_GATEWAY_AUTH_TYPES = AUTH_TYPES;

export function McpGatewayForm({
  mode,
  existing,
  isSubmitting,
  onCancel,
  onSubmit,
  serverError,
}: McpGatewayFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
    defaultValues: buildDefaultValues(existing),
  });

  const authType = form.watch('authType');

  const handleSubmit = (values: FormValues) => {
    form.clearErrors('root.serverError');
    onSubmit(values);
  };

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <FormField
          name="name"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Name')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Banking Gateway" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="url"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('URL')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder="https://mcp.example.com/rpc" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="description"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Description')}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={2} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="authType"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Authentication')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(val) => {
                  field.onChange(val);
                  form.setValue('token', '');
                  form.setValue('apiKey', '');
                  form.setValue('headerName', '');
                  form.setValue('headerValue', '');
                }}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="NONE">{t('None')}</SelectItem>
                  <SelectItem value="BEARER">{t('Bearer token')}</SelectItem>
                  <SelectItem value="API_KEY">{t('API key')}</SelectItem>
                  <SelectItem value="HEADER">{t('Custom header')}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {authType === 'BEARER' && (
          <FormField
            name="token"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Token')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    placeholder={
                      mode === 'edit' ? t('Leave blank to keep existing') : ''
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {authType === 'API_KEY' && (
          <>
            <FormField
              name="headerName"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Header name')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="X-Api-Key" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="apiKey"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('API key')}</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {authType === 'HEADER' && (
          <>
            <FormField
              name="headerName"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Header name')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="X-Custom-Header" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="headerValue"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Header value')}</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {serverError && (
          <div className="text-sm text-destructive">{serverError}</div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {mode === 'create' ? t('Create') : t('Save')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function buildDefaultValues(
  existing?: McpGatewayWithoutSensitiveData,
): FormValues {
  if (!existing) {
    return {
      name: '',
      url: '',
      description: '',
      authType: 'NONE',
      token: '',
      headerName: '',
      headerValue: '',
      apiKey: '',
    };
  }
  const auth = existing.auth;
  return {
    name: existing.name,
    url: existing.url,
    description: existing.description ?? '',
    authType: auth.type,
    token: '',
    apiKey: '',
    headerName:
      auth.type === 'API_KEY' || auth.type === 'HEADER' ? auth.headerName : '',
    headerValue: '',
  };
}

export type McpGatewayFormValues = FormValues;
