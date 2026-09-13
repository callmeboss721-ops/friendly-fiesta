import { bankIdentity } from '@/lib/ct/bankIdentity';

export default function BankLogo({
  bankName,
  eager = false,
  size = 36,
}: {
  bankName: string;
  eager?: boolean;
  size?: number;
}) {
  const identity = bankIdentity(bankName);
  return (
    <img
      className="bank-logo"
      src={identity.localAsset}
      alt=""
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      aria-label={identity.alt}
      title={identity.alt}
      data-bank-code={identity.bankCode}
      data-known={identity.known ? '1' : '0'}
    />
  );
}
