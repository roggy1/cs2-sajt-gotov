import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCatalog } from "@/lib/catalog/useCatalog";
import { useCatalogSearch } from "@/lib/catalog/useCatalogSearch";
import type { CatalogItem } from "@/lib/catalog/types";
import { catalogDisplayName } from "@/lib/catalog/doppler";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Searchable combobox over the full CS2 item catalog (skins, stickers,
 * agents, cases, music kits, patches, graffiti, keychains — ~10,000+ items).
 * The catalog loads in the background via TanStack Query + IndexedDB cache;
 * typing still works immediately as free text even before/if it loads.
 */
export function CatalogCombobox({
  query,
  onQueryChange,
  selectedImage,
  categoryFilter,
  onItemSelect,
  placeholder,
  error,
  flash,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  selectedImage: string | undefined;
  categoryFilter: string;
  onItemSelect: (item: CatalogItem) => void;
  placeholder: string;
  error?: boolean;
  /** Briefly pulses the border to draw attention on a failed submit. */
  flash?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { data: items, isLoading, isError } = useCatalog();
  const results = useCatalogSearch(items, query, categoryFilter);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={error || undefined}
          className={cn(
            "w-full justify-between font-normal",
            error && "border-red-500 hover:border-red-500 focus-visible:ring-red-500",
            error && flash && "field-error-flash",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedImage && (
              <img src={selectedImage} alt="" className="h-6 w-9 shrink-0 object-contain" />
            )}
            <span className="truncate">{query || placeholder}</span>
          </span>
          {isLoading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        {/* shouldFilter=false: we run our own Fuse.js fuzzy search over the
            full catalog (see useCatalogSearch) instead of cmdk's built-in
            substring filter, which only works against each item's `value`. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={query} onValueChange={onQueryChange} />
          <CommandList>
            {isError ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("catalogError")}
              </p>
            ) : (
              <>
                <CommandEmpty>{isLoading ? t("catalogLoading") : t("noSkinFound")}</CommandEmpty>
                <CommandGroup>
                  {results.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        onItemSelect(item);
                        setOpen(false);
                      }}
                      className="gap-3"
                    >
                      <img
                        src={item.image}
                        alt=""
                        loading="lazy"
                        className="h-8 w-12 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span
                          className={cn(
                            item.isStattrak && "font-semibold text-primary",
                            // Legacy souvenirs (from official Major Souvenir
                            // Packages) get their own gold treatment.
                            item.isSouvenir && "font-semibold text-amber-400",
                          )}
                        >
                          {catalogDisplayName(item)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.category}
                      </span>
                      {query === item.name && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
