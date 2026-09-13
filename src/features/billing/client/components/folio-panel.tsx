"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  balanceMinor,
  chargedMinor,
  FolioStatus,
  LINE_TYPE_VALUES,
  LineType,
  paidMinor,
  PAYMENT_METHOD_VALUES,
  PaymentMethod,
  PaymentStatus,
  priceLine,
} from "@/features/billing";
import { useErrorHandlers } from "@/lib/errors";
import { useEnumLabels } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

/**
 * The bill.
 *
 * Reads the folio rather than `Reservation.totalMinor`, which is what the
 * booking was *quoted* — a quote and a bill are different numbers the moment
 * anything is added, voided or paid, and only one of them is what the guest
 * owes.
 *
 * A folio is opened on the first look rather than with the booking: most
 * bookings are made months ahead, and a legal number taken then is burnt on a
 * stay that may never happen.
 */
export function FolioPanel({
  propertyId,
  reservationId,
}: {
  propertyId: number;
  reservationId: number;
}) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const typeLabels = useEnumLabels("lineType", LINE_TYPE_VALUES);
  const methodLabels = useEnumLabels("paymentMethod", PAYMENT_METHOD_VALUES);
  const { handleError } = useErrorHandlers();

  const [folioId, setFolioId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const open = trpc.billing.folioForReservation.useMutation({
    onSuccess: (folio) => setFolioId(folio.id),
    onError: (error) => handleError(error),
  });

  const { data: folio, isLoading } = trpc.billing.get.useQuery(
    { propertyId, id: folioId ?? 0 },
    { enabled: folioId !== null }
  );

  const settled = {
    onError: (error: unknown) => handleError(error),
    onSettled: () => {
      if (folioId !== null) utils.billing.get.invalidate({ propertyId, id: folioId });
      // The card's own header still shows what the booking was quoted.
      utils.reservation.byPublicId.invalidate();
    },
  };

  const postLine = trpc.billing.postLine.useMutation(settled);
  const voidLine = trpc.billing.voidLine.useMutation(settled);
  const takePayment = trpc.billing.takePayment.useMutation(settled);
  const close = trpc.billing.close.useMutation({
    ...settled,
    onSuccess: () => toast.success(t("closed")),
  });

  const pending =
    postLine.isPending || voidLine.isPending || takePayment.isPending || close.isPending;

  if (folioId === null) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("heading")}</h2>
        <Button
          size="sm"
          disabled={open.isPending}
          onClick={() => open.mutate({ propertyId, reservationId })}
        >
          {t("openBill")}
        </Button>
        <p className="text-muted-foreground text-xs">{t("openHint")}</p>
      </section>
    );
  }

  if (isLoading || !folio) return <Skeleton className="h-48 w-full" />;

  const charged = chargedMinor(folio.lines);
  const paid = paidMinor(folio.payments);
  const balance = balanceMinor(folio.lines, folio.payments);
  const money = (minor: number) => formatMoney(minor, folio.currencyCode, locale);
  const isOpen = folio.status === FolioStatus.OPEN;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{t("heading")}</h2>
        <span className="text-muted-foreground font-mono text-xs">{folio.number}</span>
        <Badge variant={isOpen ? "outline" : "secondary"}>
          {isOpen ? t("status.open") : t("status.closed")}
        </Badge>
      </div>

      {folio.lines.length === 0 && folio.payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded border text-sm">
          {folio.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {/* A void is struck through rather than removed: a bill somebody
                  has already seen is a record. */}
              <span
                className={cn("font-medium", line.voidedAt && "text-muted-foreground line-through")}
              >
                {line.description}
              </span>
              <span className="text-muted-foreground text-xs">
                {typeLabels[line.type as LineType] ?? line.type}
              </span>
              {line.quantity > 1 && (
                <span className="text-muted-foreground text-xs">× {line.quantity}</span>
              )}
              <span className="ml-auto tabular-nums">{money(line.amountMinor)}</span>
              {isOpen && !line.voidedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => voidLine.mutate({ propertyId, id: line.id })}
                >
                  {t("void")}
                </Button>
              )}
            </li>
          ))}

          {folio.payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-medium">
                {methodLabels[payment.method as PaymentMethod] ?? payment.method}
              </span>
              <Badge variant="outline" className="text-xs">
                {payment.status === PaymentStatus.REFUNDED ? t("refunded") : t("paid")}
              </Badge>
              <span className="ml-auto tabular-nums">−{money(payment.amountMinor)}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">{t("charged")}</dt>
          <dd className="font-medium tabular-nums">{money(charged)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">{t("taken")}</dt>
          <dd className="font-medium tabular-nums">{money(paid)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">{t("balance")}</dt>
          <dd className={cn("font-medium tabular-nums", balance !== 0 && "text-destructive")}>
            {money(balance)}
          </dd>
        </div>
      </dl>

      {isOpen && (
        <>
          <AddLine
            pending={pending}
            typeLabels={typeLabels}
            currencyCode={folio.currencyCode}
            locale={locale}
            onPost={(line) => postLine.mutate({ propertyId, folioId: folio.id, ...line })}
          />
          <TakePayment
            pending={pending}
            balance={balance}
            methodLabels={methodLabels}
            onTake={(amountMinor, method) =>
              takePayment.mutate({ propertyId, folioId: folio.id, amountMinor, method })
            }
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || balance !== 0}
              onClick={() => close.mutate({ propertyId, id: folio.id })}
            >
              {t("close")}
            </Button>
            {/* Said before the button is pressed: a folio that closes with a
                balance is a debt nobody is tracking. */}
            {balance !== 0 && (
              <span className="text-muted-foreground text-xs">{t("mustBalance")}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function AddLine({
  pending,
  typeLabels,
  currencyCode,
  locale,
  onPost,
}: {
  pending: boolean;
  typeLabels: Record<string, string>;
  currencyCode: string;
  locale: string;
  onPost: (line: {
    type: LineType;
    description: string;
    quantity: number;
    unitPriceMinor: number;
  }) => void;
}) {
  const t = useTranslations("billing");
  const [type, setType] = useState<LineType>(LineType.EXTRA);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const unitPriceMinor = Number(amount);
  const valid = description.trim().length > 0 && Number.isInteger(unitPriceMinor) && amount !== "";

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={type} onValueChange={(value) => setType(value as LineType)} disabled={pending}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LINE_TYPE_VALUES.map((value) => (
            <SelectItem key={value} value={value}>
              {typeLabels[value] ?? value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        className="h-8 w-48"
        placeholder={t("descriptionPlaceholder")}
        value={description}
        disabled={pending}
        onChange={(event) => setDescription(event.target.value)}
      />

      {/* Minor units, said plainly — a money input is its own decision and this
          is not the screen to take it on. */}
      <Input
        className="h-8 w-28"
        type="number"
        placeholder={t("amountPlaceholder")}
        value={amount}
        disabled={pending}
        onChange={(event) => setAmount(event.target.value)}
      />
      <span className="text-muted-foreground text-xs">
        {valid
          ? formatMoney(
              priceLine({ quantity: 1, unitPriceMinor }).amountMinor,
              currencyCode,
              locale
            )
          : currencyCode}
      </span>

      <Button
        size="sm"
        disabled={pending || !valid}
        onClick={() => {
          onPost({ type, description: description.trim(), quantity: 1, unitPriceMinor });
          setDescription("");
          setAmount("");
        }}
      >
        {t("post")}
      </Button>
    </div>
  );
}

function TakePayment({
  pending,
  balance,
  methodLabels,
  onTake,
}: {
  pending: boolean;
  balance: number;
  methodLabels: Record<string, string>;
  onTake: (amountMinor: number, method: PaymentMethod) => void;
}) {
  const t = useTranslations("billing");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CARD);

  // The balance, because that is what a desk takes almost every time.
  const owed = Math.max(balance, 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={method}
        onValueChange={(value) => setMethod(value as PaymentMethod)}
        disabled={pending}
      >
        <SelectTrigger size="sm" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_METHOD_VALUES.map((value) => (
            <SelectItem key={value} value={value}>
              {methodLabels[value] ?? value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="sm" disabled={pending || owed <= 0} onClick={() => onTake(owed, method)}>
        {t("takeBalance")}
      </Button>
    </div>
  );
}
