import type { FormField } from '../types';

// Parser tolerante das options de um SELECT. O backend persiste `options` como
// string JSON de um array — de strings (ex.: ['sim','nao']) ou de objetos
// { value, label }. Aceita ambos e normaliza para { value, label }.
export function parseFieldOptions(field: Pick<FormField, 'options'>): { value: string; label: string }[] {
  if (!field.options) return [];
  let parsed: unknown;
  try {
    parsed = typeof field.options === 'string' ? JSON.parse(field.options) : field.options;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((o) => {
    if (o && typeof o === 'object') {
      const obj = o as Record<string, unknown>;
      const value = String(obj.value ?? obj.label ?? '');
      const label = String(obj.label ?? obj.value ?? '');
      return { value, label };
    }
    const v = String(o);
    return { value: v, label: v.charAt(0).toUpperCase() + v.slice(1) };
  });
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500';

// Mapeia o tipo lógico do campo para o type/inputmode do <input> nativo.
function htmlInputType(type: FormField['type']): { type: string; inputMode?: string } {
  switch (type) {
    case 'NUMBER':
    case 'MONEY':
      return { type: 'text', inputMode: 'decimal' };
    case 'DATE':
      return { type: 'date' };
    case 'EMAIL':
      return { type: 'email' };
    case 'PHONE':
      return { type: 'tel' };
    default:
      return { type: 'text' };
  }
}

interface DynamicFieldProps {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// Renderiza UM campo dinâmico conforme seu tipo. SELECT usa options; TEXTAREA
// vira multilinha; os demais usam <input> com o type/inputmode adequado.
export default function DynamicField({ field, value, onChange, disabled }: DynamicFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {field.label}
        {field.required && <span className="text-golplus-orange-600"> *</span>}
        {field.sensitiveType && (
          <span className="ml-2 text-xs font-normal text-gray-400" title="Dado sensível — protegido (LGPD)">
            🔒 sensível
          </span>
        )}
      </label>
      {field.type === 'SELECT' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputClass}
        >
          <option value="">— Selecionar —</option>
          {parseFieldOptions(field).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === 'TEXTAREA' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          className={inputClass}
        />
      ) : (
        (() => {
          const { type, inputMode } = htmlInputType(field.type);
          return (
            <input
              type={type}
              inputMode={inputMode as React.HTMLAttributes<HTMLInputElement>['inputMode']}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              className={inputClass}
            />
          );
        })()
      )}
    </div>
  );
}
