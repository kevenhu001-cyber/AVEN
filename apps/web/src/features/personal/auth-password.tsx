'use client';
import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AuthPassword(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password">
      <Input {...props} type={visible ? 'text' : 'password'} />
      <Button
        className="auth-password-toggle"
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        onClick={() => setVisible((old) => !old)}
      >
        {visible ? <EyeOff size={19} strokeWidth={1.7} /> : <Eye size={19} strokeWidth={1.7} />}
      </Button>
    </div>
  );
}
