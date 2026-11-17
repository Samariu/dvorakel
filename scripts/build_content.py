#!/usr/bin/env python3
"""Build Dvorakel's bundled word lists and literature quotes.

Usage:
    python -m venv .venv && .venv/bin/pip install spylls
    .venv/bin/python scripts/build_content.py <download-dir>

Sources (downloaded into <download-dir>, not committed):
  * Word frequencies: hermitdave/FrequencyWords (OpenSubtitles 2018), CC BY-SA 4.0
  * Spell-check dictionaries used to decide casing / filter proper names:
    LibreOffice/dictionaries (de_DE_frami, en_US)
  * Public-domain literature from Project Gutenberg (via the GITenberg mirror)
"""
import json
import os
import random
import re
import sys
import urllib.request

from spylls.hunspell import Dictionary

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "content")

FREQ = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/{l}/{l}_50k.txt"
DICT = "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/{path}"
GIT = "https://raw.githubusercontent.com/GITenberg/{repo}/master/{file}"

BOOKS = {
    "de": [
        ("Die-Verwandlung_22367", "22367-8.txt", "Franz Kafka", "Die Verwandlung"),
        ("Effi-Briest_5323", "5323-8.txt", "Theodor Fontane", "Effi Briest"),
        ("Die-Leiden-des-jungen-Werther---Band-1_2407", "2407-8.txt", "Johann Wolfgang von Goethe", "Die Leiden des jungen Werther"),
        # Added later: append only, so earlier quotes keep their selection.
        ("Der-Stechlin-Roman_53628", "53628-0.txt", "Theodor Fontane", "Der Stechlin"),
        ("Unterm-Birnbaum_26686", "26686-8.txt", "Theodor Fontane", "Unterm Birnbaum"),
        ("Frau-Jenny-TreibelRoman-aus-der-Berliner-Gesellschaft_46184", "46184-8.txt", "Theodor Fontane", "Frau Jenny Treibel"),
        ("Schach-von-WuthenowErz-hlung-aus-der-Zeit-des-Regiments-Gensdarmes_36905", "36905-8.txt", "Theodor Fontane", "Schach von Wuthenow"),
        ("L-Adultera-Roman_52912", "52912-0.txt", "Theodor Fontane", "L'Adultera"),
        ("BuddenbrooksVerfall-einer-Familie_34811", "34811-8.txt", "Thomas Mann", "Buddenbrooks"),
        ("K-nigliche-HoheitRoman_35328", "35328-8.txt", "Thomas Mann", "Königliche Hoheit"),
        ("Tonio-Kr-ger_23313", "23313-8.txt", "Thomas Mann", "Tonio Kröger"),
        ("Der-Prozess-Roman_69327", "69327-0.txt", "Franz Kafka", "Der Prozess"),
        ("Der-Schimmelreiter_74008", "74008-0.txt", "Theodor Storm", "Der Schimmelreiter"),
        ("Brennendes-GeheimnisErz-hlung_24173", "24173-8.txt", "Stefan Zweig", "Brennendes Geheimnis"),
        ("Casanovas-Heimfahrt_18148", "18148-8.txt", "Arthur Schnitzler", "Casanovas Heimfahrt"),
        ("Aus-dem-Leben-eines-TaugenichtsNovelle_35312", "35312-8.txt", "Joseph von Eichendorff", "Aus dem Leben eines Taugenichts"),
    ],
    "en": [
        ("Pride-and-Prejudice_1342", "1342.txt", "Jane Austen", "Pride and Prejudice"),
        ("The-Adventures-of-Tom-Sawyer_74", "74-0.txt", "Mark Twain", "The Adventures of Tom Sawyer"),
        ("The-Picture-of-Dorian-Gray_174", "174.txt", "Oscar Wilde", "The Picture of Dorian Gray"),
        # Added later: append only, so earlier quotes keep their selection.
        ("Emma_158", "158.txt", "Jane Austen", "Emma"),
        ("Persuasion_105", "105.txt", "Jane Austen", "Persuasion"),
        ("Sense-and-Sensibility_161", "161.txt", "Jane Austen", "Sense and Sensibility"),
        ("Great-Expectations_1400", "1400.txt", "Charles Dickens", "Great Expectations"),
        ("Jane-Eyre_1260", "1260.txt", "Charlotte Brontë", "Jane Eyre"),
        ("Middlemarch_145", "145.txt", "George Eliot", "Middlemarch"),
        ("Frankenstein_84", "84.txt", "Mary Shelley", "Frankenstein"),
        ("The-Adventures-of-Sherlock-Holmes_1661", "1661.txt", "Arthur Conan Doyle", "The Adventures of Sherlock Holmes"),
        ("Little-Women_514", "514.txt", "Louisa May Alcott", "Little Women"),
        ("Anne-of-Green-Gables_45", "45.txt", "L. M. Montgomery", "Anne of Green Gables"),
        ("The-Age-of-Innocence_541", "541.txt", "Edith Wharton", "The Age of Innocence"),
        ("The-Call-of-the-Wild_215", "215.txt", "Jack London", "The Call of the Wild"),
    ],
}

# Extra German books used only to learn noun capitalisation.
EXTRA_DE = [
    ("Der-Stechlin-Roman_53628", "53628-0.txt", "", ""),
    ("Unterm-Birnbaum_26686", "26686-8.txt", "", ""),
    ("BuddenbrooksVerfall-einer-Familie_34811", "34811-8.txt", "", ""),
]

BLOCK = set("""
fuck fucking fucked fucker shit shitty bitch bitches bastard asshole cunt dick dicks cock pussy whore slut
damn goddamn nigger nigga fag faggot retard twat wank wanker
tit tits shag niggers fags faggots dicks cocks bitching fuckin motherfucker motherfuckers shitting bullshit
scheiße scheisse scheiß scheiss arsch arschloch fick ficken fickt gefickt hure schlampe wichser fotze schwuchtel neger
""".split())

# Prefixes of slurs/profanity: any word starting with one is dropped.
BLOCK_PREFIX = ("nigg", "fag", "cunt", "fuck", "shit", "bitch", "whore", "slut", "retard",
                "hure", "fotze", "schwuchtel", "wichser", "neger", "arschloch", "scheiß", "scheiss")

# Subtitle filler, contraction fragments and common first names.
NOISE_EN = set("""
uh um oh ah hey yeah gonna wanna gotta hmm huh ok okay la da ha whoa wow yo mm ooh aw hm na
don isn didn doesn couldn wouldn shouldn wasn weren haven hasn aren ain ll ve re
""".split())
NOISE_DE = set("""
oh ah hey okay ok hm hmm äh ähm ha wow yeah whoa jo
""".split())
NAMES = set("""
tom peter max sam jack john michael paul frank mike david charlie ben alex harry george james joe nick
anna maria thomas daniel martin hans karl fritz klaus stefan andreas markus jan lisa sarah emma tim
monsieur madame senor mister stiles
""".split())

# Light orthographic modernisation of pre-1996 spellings in the literature.
MODERN = {
    "daß": "dass", "Daß": "Dass", "muß": "muss", "mußte": "musste", "mußten": "mussten", "mußt": "musst",
    "läßt": "lässt", "laß": "lass", "Laß": "Lass", "faßte": "fasste", "gewußt": "gewusst", "wußte": "wusste",
    "wußten": "wussten", "weiß": "weiß", "Schluß": "Schluss", "bißchen": "bisschen", "Thür": "Tür",
    "Thüre": "Türe", "Thür.": "Tür.", "Theil": "Teil", "theil": "teil", "That": "Tat", "thun": "tun",
    "thut": "tut", "Thier": "Tier", "Thiere": "Tiere", "Thal": "Tal", "giebt": "gibt", "Muth": "Mut",
    "läßt": "lässt", "müßte": "müsste", "küßte": "küsste", "Kuß": "Kuss", "Fluß": "Fluss", "gewiß": "gewiss",
    "Gewißheit": "Gewissheit", "faßt": "fasst", "mißt": "misst", "Haß": "Hass", "eßt": "esst", "ißt": "isst",
    "wußt": "wusst", "Paß": "Pass", "Genuß": "Genuss", "Entschluß": "Entschluss", "Einfluß": "Einfluss",
}
ARCHAIC = re.compile(r"\b\w*(ß[st]|ßt|Th[aeiouäöü]|th[aeiouäöü]?r?\b)", re.U)
ALLOWED = re.compile(r"^[A-Za-zÄÖÜäöüß0-9 .,;:!?'\"()\-]+$")


def fetch(url, dest):
    if not os.path.exists(dest):
        print("download", url)
        urllib.request.urlretrieve(url, dest)
    return dest


def load_dict(cache, path):
    base = os.path.join(cache, os.path.basename(path))
    fetch(DICT.format(path=path + ".dic"), base + ".dic")
    fetch(DICT.format(path=path + ".aff"), base + ".aff")
    return Dictionary.from_files(base)


def freq_words(cache, lang):
    p = fetch(FREQ.format(l=lang), os.path.join(cache, f"{lang}_50k.txt"))
    with open(p, encoding="utf-8") as f:
        for line in f:
            w = line.split(" ")[0].strip()
            if w:
                yield w


def build_words(cache, lang, d, en_dict, casing=None, n_big=10000):
    casing = casing or {}
    pat = re.compile(r"^[a-zäöüß]+$" if lang == "de" else r"^[a-z]+$")
    out, seen = [], set()
    for w in freq_words(cache, lang):
        noise = NOISE_DE if lang == "de" else NOISE_EN
        if not pat.match(w) or w in seen or w in noise or w in NAMES:
            continue
        if w.startswith(BLOCK_PREFIX) or w in BLOCK or any(w.endswith(x) and w[: -len(x)] in BLOCK for x in ("s", "es", "ed", "ing", "er", "ers")):
            continue
        if len(w) == 1 and w not in ("a", "i"):
            continue
        cap = w[0].upper() + w[1:]
        if lang == "en":
            if w == "i":
                word = "I"
            elif d.lookup(w):
                word = w
            else:
                continue  # proper names / not a word
        else:
            low_ok, cap_ok = d.lookup(w), d.lookup(cap)
            if low_ok and cap_ok and casing.get(cap, 0) > 2 * casing.get(w, 0):
                word = cap  # e.g. "Ziel"/"ziel": literature uses the noun far more often
            elif low_ok:
                word = w
            elif cap_ok:
                # Noun - unless it is just a (foreign) proper name.
                if en_dict.lookup(cap) and not en_dict.lookup(w) and len(w) > 2 and w not in ("hand",):
                    continue
                word = cap
            else:
                continue
        seen.add(w)
        out.append(word)
        if len(out) >= n_big:
            break
    return out


def book_text(cache, repo, file):
    p = fetch(GIT.format(repo=repo, file=file), os.path.join(cache, repo + ".txt"))
    raw = open(p, "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    text = text.replace("\r\n", "\n")
    m = re.search(r"\*\*\* ?START OF TH[A-Z ]+\*\*\*", text)
    if m:
        text = text[m.end():]
    m = re.search(r"\*\*\* ?END OF TH", text)
    if m:
        text = text[: m.start()]
    if "*END*THE SMALL PRINT" in text:
        text = text.split("*END*THE SMALL PRINT", 1)[1].split("\n", 1)[1]
    return text


def casing_counts(cache):
    """Count cased, non-sentence-initial token occurrences in the German books."""
    counts = {}
    for repo, file, _a, _t in BOOKS["de"] + EXTRA_DE:
        text = book_text(cache, repo, file)
        for m in re.finditer(r"(?<=[a-zäöüß,;] )([A-Za-zÄÖÜäöüß]+)", text):
            t = m.group(1)
            counts[t] = counts.get(t, 0) + 1
    return counts


def normalise(s, lang):
    s = s.replace("»", '"').replace("«", '"').replace("„", '"').replace("“", '"').replace("”", '"')
    s = s.replace("‘", "'").replace("’", "'").replace("—", " - ").replace("–", "-").replace("--", " - ")
    s = s.replace("…", "...").replace("_", "")
    s = re.sub(r"\s+", " ", s).strip()
    if lang == "de":
        s = " ".join(MODERN.get(t, t) for t in s.split(" "))
        s = re.sub(r"\b(\w+)(\W*)", lambda m: MODERN.get(m.group(1), m.group(1)) + m.group(2), s)
    return s


def build_quotes(cache, lang, per_book=60, seed=42):
    rnd = random.Random(seed)
    quotes = []
    for repo, file, author, title in BOOKS[lang]:
        text = book_text(cache, repo, file)
        paras = [normalise(p, lang) for p in re.split(r"\n\s*\n", text)]
        cands = []
        for p in paras:
            # Split long paragraphs into sentence groups of 90-320 chars.
            sents = re.split(r"(?<!Mr\.)(?<!Mrs\.)(?<!Dr\.)(?<!St\.)(?<=[.!?])\s+(?=[A-ZÄÖÜ\"])", p)
            buf = ""
            for s in sents:
                buf = (buf + " " + s).strip()
                if len(buf) >= 90:
                    if len(buf) <= 320:
                        cands.append(buf)
                    buf = ""
        good = []
        for c in cands:
            if not ALLOWED.match(c) or c.isupper() or c.count('"') % 2:
                continue
            if lang == "de" and ARCHAIC.search(c):
                continue
            if lang == "en" and re.search(r"\b(CHAPTER|Chapter)\b", c):
                continue
            good.append(c)
        rnd.shuffle(good)
        for c in good[:per_book]:
            quotes.append({"text": c, "source": f"{author} - {title}", "kind": "literature"})
        print(lang, title, len(good), "candidates")
    return quotes


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    quotes_only = "--quotes-only" in sys.argv
    cache = args[0] if args else os.path.join(ROOT, ".content-cache")
    os.makedirs(cache, exist_ok=True)
    if not quotes_only:
        en_d = load_dict(cache, "en/en_US")
        de_d = load_dict(cache, "de/de_DE_frami")
    for lang in ("en", "de"):
        os.makedirs(os.path.join(OUT, lang), exist_ok=True)
        if not quotes_only:
            d = en_d if lang == "en" else de_d
            words = build_words(cache, lang, d, en_d, casing_counts(cache) if lang == "de" else None)
            with open(os.path.join(OUT, lang, "words.json"), "w", encoding="utf-8") as f:
                json.dump(words, f, ensure_ascii=False, separators=(",", ":"))
            print(lang, len(words), "words")
        quotes = build_quotes(cache, lang)
        with open(os.path.join(OUT, lang, "literature.json"), "w", encoding="utf-8") as f:
            json.dump(quotes, f, ensure_ascii=False, indent=1)
        print(lang, len(quotes), "quotes")


if __name__ == "__main__":
    main()
