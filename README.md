# CS2 Inventory Hub

Napravi mi profesionalnu, vizuelno impresivnu CS2 aplikaciju za praćenje cena skinova, budžeta i investicija u vrhunskom "dark mode" gejming dizajnu.

Aplikacija treba da ima sledeće funkcionalnosti i strukturu:

1. Jezik aplikacije, zastavice i prevod (Language Switcher):

Podrazumevani jezik cele aplikacije (dugmići, forme, tabele, naslovi) mora biti engleski.

U gornjem desnom uglu implementiraj prekidač za jezik sa dve opcije uz koje obavezno stoje male zastavice država: 🇬🇧 EN i 🇷🇸 SR. Kada korisnik klikne na jezik, sav tekst u aplikaciji se trenutno prevodi na izabrani jezik.

2. Sistem tema (UI Themes, Colors & Icons):

Implementiraj meni za promenu tema (u gornjem desnom uglu) sa tri opcije, gde svaka tema pored naziva ima i svoj prepoznatljiv zvanični simbol/ikonicu:

CS2 logo + 'Global Offensive' (Podrazumevana): Tamno siva pozadina, narandžasti akcenti.

Zvanični Counter-Terrorist simbol (ikonica štita/maske) + 'CT': Tamno plava pozadina inspirisana CS2 CT UI-jem, sa svetlijim plavim elementima (karticama).

Zvanični Terrorist simbol (ikonica lobanje/nišana) + 'T': Veoma tamna, gotovo crna pozadina, sa prigušenim (blagim) narandžastim akcentima.

Važno za boje finansija: U svim temama profit je striktno zelene boje, a gubitak (loss) je striktno crvene boje.

Izabrana tema i izabrani jezik moraju da se primene na ceo sajt i da se memorišu u pretraživaču (LocalStorage).

3. Glavni Dashboard (Statističke kartice):

Ukupna vrednost inventara (u evrima).

Ukupno uložen novac / nabavna cena.

Neto profit ili gubitak (sa zelenom bojom za plus i crvenom za minus, uz prikaz procenta).

Broj unetih skinova u inventaru.

4. Sekcija: "Moj Inventar" (Tabela / Grid):

Forma za dodavanje novog skina sa sledećim poljima:

Naziv skina (npr. AK-47 | Redline)

Oružje / Kategorija (Rifle, Pistol, Knife, Gloves...)

Stanje / Wear (Factory New, Minimal Wear, Field-Tested, Well-Worn, Battle-Scarred) - padajući meni (dropdown) sa lepim badge bojama za svako stanje.

Plaćena cena (nabavna)

Trenutna tržna cena

Tabela koja prikazuje sve unete skinove, automatski računa razliku u ceni (profit zeleno, gubitak crveno) i ima dugme za brisanje skina.

5. Sekcija: "Wishlist" (Lista želja):

Forma i lista za skinove koje planiraš da kupiš u budućnosti.

Polja: Naziv skina, Ciljana cena (koliko si spreman da platiš) i trenutna cena na tržištu.

6. Tehnički zahtevi, UX i Branding:

Koristi moderne komponente (lepe kartice sa blagom senkom, jasna dugmad, dobre ikonice).

Obavezno sačuvaj sve podatke unutar pretraživača (LocalStorage) da ne nestanu pri osvežavanju stranice.

Neka interfejs bude maksimalno responzivan i čist.

Branding / Potpis: Na vidljivom mestu u gornjem desnom uglu (pored izbora jezika, tema i ikonica) obavezno postavi diskretan tekst: "Site made by cmigi".

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/52f3aa85-8969-4f55-979b-893dbb2bb885).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
