import React from 'react';

interface RedLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const RedLogo: React.FC<RedLogoProps> = ({ className, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  }[size];

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 rounded-full transition-transform ${
        className || sizeClasses
      }`}
    >
      <img
        src="/red_logo.jpg"
        alt="RED Logo"
        referrerPolicy="no-referrer"
        className="w-full h-full object-contain rounded-full shadow-lg shadow-red-950/60 drop-shadow-md"
      />
    </div>
  );
};
