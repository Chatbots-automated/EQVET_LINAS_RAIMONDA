import { ADMINISTRATION_ROUTES, type WithdrawalFieldKey, withdrawalFieldKey } from "@/lib/administrationRoutes";

interface WithdrawalRouteFieldsProps {
  values: Record<WithdrawalFieldKey, string>;
  onChange: (field: WithdrawalFieldKey, value: string) => void;
}

/**
 * Optional per-administration-route karencija (withdrawal) inputs, shown when
 * creating/editing a medicines product. Used by the shared ProductFormFields
 * (Produktai page + Pajamavimas' quick "Sukurti naują produktą").
 */
export function WithdrawalRouteFields({ values, onChange }: WithdrawalRouteFieldsProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="mb-1 text-sm font-medium text-slate-800">Karencija pagal administravimo būdą (nebūtina)</p>
      <p className="mb-3 text-xs text-slate-500">
        Jei skirtingi suleidimo būdai (i.v, i.m, s.c...) turi skirtingą karenciją, nurodykite čia. Registruojant
        vizitą pasirinkus būdą, sistema automatiškai naudos atitinkamą reikšmę; jei laukas tuščias, naudojama
        numatytoji karencija aukščiau.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ADMINISTRATION_ROUTES.map((route) => {
          const meatKey = withdrawalFieldKey(route.code, "meat");
          const milkKey = withdrawalFieldKey(route.code, "milk");
          return (
            <div key={route.code} className="rounded-lg border border-slate-200 bg-white p-2.5">
              <p className="mb-1.5 text-xs font-semibold text-slate-700">{route.fullLabel}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-500">🥩 Mėsa</label>
                  <input
                    type="number"
                    value={values[meatKey]}
                    onChange={(e) => onChange(meatKey, e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="—"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-500">🥛 Pienas</label>
                  <input
                    type="number"
                    value={values[milkKey]}
                    onChange={(e) => onChange(milkKey, e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="—"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
