import { resolveBank } from '@/lib/bankBrands';

type BankLogoProps = {
  bankName: string | null | undefined;
  eager?: boolean;
  decorative?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

export default function BankLogo({
  bankName,
  eager = false,
  decorative = false,
  size = 'md',
}: BankLogoProps) {
  const brand = resolveBank(bankName);
  const className = `bank-logo bank-logo--${size}`;

  if (brand.localAsset && brand.officialSource && brand.verifiedAt) {
    return (
      <img
        className={className}
        src={brand.localAsset}
        alt={decorative ? '' : brand.alt}
        aria-hidden={decorative || undefined}
        width={size === 'sm' ? 28 : size === 'lg' ? 44 : 36}
        height={size === 'sm' ? 28 : size === 'lg' ? 44 : 36}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    );
  }

  const label = brand.code === 'UNKNOWN' ? '?' : brand.code;
  return (
    <span
      className={`${className} bank-logo--fallback`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : brand.alt}
      title={decorative ? undefined : brand.nameTh}
      data-bank-code={brand.code}
    >
      {label}
    </span>
  );
}
