import { getBankBrand } from '@/lib/bankBrands';

export default function BankLogo({ bankName, eager = false }: { bankName: string; eager?: boolean }) {
  const brand = getBankBrand(bankName);
  if (brand?.localAsset && brand.officialSource && brand.verifiedAt) {
    return <img className="bank-logo" src={brand.localAsset} alt={brand.alt} width={36} height={36} loading={eager ? 'eager' : 'lazy'} />;
  }

  const label = brand?.code ?? bankName.slice(0, 3).toUpperCase();
  return (
    <span className="bank-logo bank-logo--fallback" role="img" aria-label={brand?.alt ?? `ธนาคาร ${bankName}`} title={brand?.nameTh ?? bankName}>
      {label}
    </span>
  );
}
