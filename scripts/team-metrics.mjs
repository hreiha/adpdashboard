/**
 * team-metrics.mjs
 *
 * The Bids and IT dashboard: headcount broken down several ways, plus average age
 * and average tenure. No turnover, no pay gap, no recruitment.
 *
 * Who counts is decided by scopeEmployees in metrics.mjs, not here, so this page and the
 * P&C dashboard can never disagree about the total.
 *
 * Output shape is deliberately different from data.json. The P&C dashboard precomputes
 * every filter combination because it carries a dozen rates per slice. This one carries
 * one anonymised row per person and lets the page do the filtering, because the
 * breakdowns multiply out to far too many combinations to precompute, and because an
 * exact answer for any filter combination beats an approximate one.
 */

import { scopeEmployees, parseDate, monthEnd, activeAt, tidyLocation } from "./metrics.mjs";

// ---------------------------------------------------------------- configuration

const NOT_RECORDED = "Unknown";

/**
 * Position grade and discipline are read out of the job title.
 *
 * Employment Hero holds both as CUSTOM fields, which are not part of the employee payload
 * and could not be read reliably from the custom field endpoints. The job title is written
 * "<grade> I <discipline>", with a lone capital I as the separator, not a pipe.
 *
 * Measured against the October export: grade resolves on 97% of active people and
 * discipline on 85%. The rest are titles that carry no discipline, such as Engineering
 * Assistant, and they show as Unknown rather than being guessed at.
 */

// Longest match wins, so Associate Director beats both Associate and Director, and
// Graduate Engineer beats Engineer. Order here does not matter; length does.
const GRADES = [
  "Managing Director", "Regional Director", "Technical Director", "Associate Director",
  "Director", "Senior Associate", "Associate", "Principal",
  "Senior Consultant", "Consultant",
  "Graduate Engineer", "Senior Engineer", "Engineer",
  "Senior BIM Designer", "BIM Designer", "BIM Cadet", "BIM Lead",
  "Senior Designer", "Designer", "Design Drafter",
  "Senior Technician", "Technician",
  "Senior Specialist", "Specialist", "Senior Advisor", "Advisor", "Adviser",
  "Senior Manager", "Manager", "Coordinator", "Administrator", "Analyst",
  "Officer", "Support", "Graduate", "Student", "Intern", "Cadet",
  "Bid Writer", "Document Controller", "Construction Administration"
];

// Canonical disciplines, so that Mechanical Team Lead, Fire Protection & Hydraulics and
// BIM Lead I NSW all land on a single row instead of three. Longest alias wins, which is
// why "fire protection" beats "fire" and "project administrator" beats "projects".
const DISCIPLINES = [
  // ---- engineering disciplines
  ["Mechanical", ["mechanical"]],
  ["Electrical", ["electrical", "asp3", "asp 3"]],
  ["Hydraulics", ["hydraulic"]],
  ["Fire Protection", ["fire protection", "fire & hydraulics"]],
  ["Fire Safety", ["fire safety"]],
  ["Sustainability", ["sustainability", "esd", "esg"]],
  ["Acoustics", ["acoustic"]],
  ["Civil", ["civil"]],
  ["Structures", ["structural", "structures"]],
  ["Data Centres", ["data centre", "data center"]],
  ["ICT/AV", ["ict/av", "ict", "av"]],
  ["BIM", ["bim", "digital engineering", "model manager"]],
  ["Digital Innovation", ["digital innovation"]],
  ["Vertical Transportation", ["vertical transport"]],
  ["Specialist Lighting", ["specialist lighting", "lighting"]],
  ["CFD", ["cfd"]],
  ["Major Projects", ["major projects", "projects"]],

  // Sector leads, who are named for the market they serve rather than an engineering
  // discipline. Health & Life Sciences and Energy were their own rows and are folded in
  // here, along with the Aviation and Retail leads.
  ["Sector", ["sector", "health", "healthcare", "life sciences", "laboratory",
              "energy", "aviation", "retail", "defence", "education"]],

  // ---- non-engineering. Corporate is deliberately narrow: finance, marketing, IT and
  // people & culture only. Everything else that used to land there now has its own row.
  ["Corporate", ["corporate",
                 // finance
                 "finance", "accountant", "accounts", "payroll",
                 // marketing and communications
                 "marketing", "communications",
                 // IT
                 "head of it", "it support", "it manager", "information technology",
                 "technology", "it",
                 // people and culture, talent, L&D
                 "people & culture", "people and culture", "talent",
                 "learning & development", "learning and development"]],

  ["Bids", ["bid", "bids", "bid writer", "bid manager", "tender", "submissions"]],

  // Engineering assistants and interns, reported as a cohort rather than left Unknown.
  // "=intern" means the alias has to be a whole word, so it cannot match "international".
  // A bare "assistant" is deliberately not an alias: it would outrank "accounts" and put
  // the Accounts Assistant in here instead of Corporate.
  ["Intern", ["engineering assistant", "engineering intern", "engineering trainee",
              "=intern", "=interns"]],

  ["Business Support", ["business support", "office coordinator", "office manager",
                        "executive assistant", "document controller", "receptionist",
                        "administration assistant", "project administrator",
                        "project coordinator", "construction administration",
                        "contracts coordinator"]],

  // Leadership roles whose title records a region, sector or function rather than a
  // discipline: a bare Director, a Regional Lead, a Founding Director.
  ["Leadership", ["director", "founding director", "regional director",
                  "managing director", "regional lead",
                  "strategic growth", "strategic partnerships", "operations",
                  "head of people", "chief"]]
];

/**
 * Cost centres that are a single discipline, used when the title carries none. Every title
 * inside NAT-ESD is Sustainability or Energy, and every title inside NAT-DIG is Digital
 * Innovation, so an Engineering Assistant in either is safely placed.
 *
 * NAT-SPL is deliberately absent: it is the Specialist Disciplines team and holds ICT,
 * Fire Safety, Acoustics, Vertical Transportation, Lighting and CFD, so it says nothing
 * about an individual.
 */
const CENTRE_DISCIPLINE = [
  ["nat-esd", "Sustainability"],
  ["nat-dig", "Digital Innovation"],
  ["nat-corp", "Corporate"]
];

/**
 * Grades folded into another grade, applied after the title has been matched.
 *
 * These are Hayley's calls about which grades are really the same level, not anything the
 * data says, so they live in one list that can be changed without touching the matcher.
 */
const GRADE_MERGE = {
  "Manager": "Senior Associate",
  "Senior Manager": "Senior Associate",
  "Construction Administration": "Senior Engineer",
  "Design Drafter": "BIM Designer",
  "Document Controller": "Coordinator",
  "Officer": "Advisor",
  "Regional Director": "Director",
  "Senior Designer": "Senior BIM Designer"
};

const CORPORATE = "Corporate";

/**
 * Some titles carry trailing zero width spaces from a paste into Employment Hero, which
 * would otherwise defeat both the separator match and the alias match.
 */
function cleanTitle(jobTitle) {
  return String(jobTitle || "")
    .replace(/[​-‍﻿ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits "Senior Engineer I Hydraulics" on the lone capital I. */
function splitTitle(jobTitle) {
  const t = cleanTitle(jobTitle);
  if (!t) return { left: "", right: "" };
  const m = t.match(/^(.*?)\s+I\s+(.*)$/);
  if (m) return { left: m[1].trim(), right: m[2].trim() };
  return { left: t, right: "" };
}

function isCorporateCentre(costCentre) {
  return /corp/i.test(String(costCentre || ""));
}

/** Discipline implied by a single discipline cost centre, or "" if it implies none. */
function centreDiscipline(costCentre) {
  const c = String(costCentre || "").toLowerCase();
  for (const entry of CENTRE_DISCIPLINE) {
    if (c.indexOf(entry[0]) >= 0) return entry[1];
  }
  return "";
}

/** Position grade from the part before the separator, then folded per GRADE_MERGE. */
export function positionGrade(jobTitle, costCentre) {
  const left = splitTitle(jobTitle).left;
  if (left) {
    const hay = left.toLowerCase();
    let best = "";
    for (const g of GRADES) {
      const needle = g.toLowerCase();
      if (hay.indexOf(needle) >= 0 && needle.length > best.length) best = g;
    }
    if (best) return GRADE_MERGE[best] || best;
  }
  if (isCorporateCentre(costCentre)) return CORPORATE;
  return NOT_RECORDED;
}

/**
 * Every alias has to start at a word boundary, and a short one has to end at one too.
 *
 * Plain substring matching is not safe here. "av" appears inside "Aviation", which put an
 * Aviation Lead in ICT/AV, and "it" appears inside half the words in English. Requiring a
 * word boundary at the start only would still match "Aviation", so aliases of four
 * characters or fewer have to be whole words.
 *
 * Longer aliases keep the loose tail on purpose, so that "hydraulic" matches Hydraulics,
 * "acoustic" matches Acoustics and "vertical transport" matches Vertical Transportation
 * without needing every plural spelled out.
 */
// Prefixing an alias with "=" forces the whole word rule on at any length, which is how
// "intern" is kept out of "international".
const ALIAS_TESTS = DISCIPLINES.map(entry => ({
  name: entry[0],
  tests: entry[1].map(alias => {
    const exact = alias.charAt(0) === "=";
    const word = exact ? alias.slice(1) : alias;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tail = (exact || word.length <= 4) ? "([^a-z0-9]|$)" : "";
    return { length: word.length, re: new RegExp("(^|[^a-z0-9])" + escaped + tail) };
  })
}));

const INTERN = "Intern";

function matchDiscipline(text) {
  const hay = String(text || "").toLowerCase();
  if (!hay) return "";
  let best = "";
  let bestLen = 0;
  for (const entry of ALIAS_TESTS) {
    for (const t of entry.tests) {
      if (t.length > bestLen && t.re.test(hay)) {
        best = entry.name;
        bestLen = t.length;
      }
    }
  }
  return best;
}

/**
 * Discipline, in order of how much the source is trusted:
 *   1. the part of the title after the separator, which is where it belongs
 *   2. the part before it, for titles like "BIM Lead I QLD" or a bare "Office Coordinator"
 *   3. the cost centre, but only for centres that are a single discipline
 * Anything still unresolved is Unknown rather than guessed at.
 */
export function discipline(jobTitle, costCentre) {
  const parts = splitTitle(jobTitle);

  // Engineering assistants and interns are reported as one cohort whichever team they sit
  // in, so this runs ahead of the usual right-then-left match. Without it, an
  // "Engineering Intern I Sustainability" would be counted as Sustainability.
  if (matchDiscipline(parts.left) === INTERN) return INTERN;

  var d = matchDiscipline(parts.right);
  if (!d) d = matchDiscipline(parts.left);
  if (!d) d = centreDiscipline(costCentre);
  if (d) return d;
  return NOT_RECORDED;
}

// ---------------------------------------------------------------- small helpers

// Rows are anonymised, so there is no small-cell risk and nothing needs suppressing.
const MIN_ROW_SIZE = 1;

function genderLabel(value) {
  const g = String(value || "").trim();
  if (!g) return NOT_RECORDED;
  const lower = g.toLowerCase();
  if (lower.indexOf("female") === 0) return "Female";
  if (lower === "male" || lower === "m") return "Male";
  return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
}

/** Year and month only. Enough for an average age, less precise than a date of birth. */
function birthYearMonth(value) {
  const d = parseDate(value);
  if (!d) return "";
  const year = d.getUTCFullYear();
  // Obvious rubbish: a placeholder date or a typo in the year
  if (year < 1930 || year > new Date().getUTCFullYear() - 14) return "";
  return year + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

/** ISO date with no time, so the rows stay small and no time zone can shift a date. */
function dayOnly(value) {
  const d = parseDate(value);
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- main

export function computeTeamData(employees, asOfIso) {
  const asOf = parseDate(asOfIso) || new Date();
  const { scoped, quality } = scopeEmployees(employees);

  const people = scoped.map(e => ({
    e: e.entity,                        // AU or UK
    l: tidyLocation(e.location),        // office, state suffix removed
    c: e.costCentre || "Unassigned",    // already NAT-grouped and London-defaulted
    g: genderLabel(e.gender),
    gr: positionGrade(e.jobTitle, e.costCentre),
    d: discipline(e.jobTitle, e.costCentre),
    s: dayOnly(e.startDate),
    t: dayOnly(e.terminationDate),
    b: birthYearMonth(e.birthDate),
    // Employment status wins over a stale termination date, same rule as the P&C dashboard
    a: String(e.status || "").toLowerCase() === "active" ? 1 : 0
  }));

  // ---- the 24 month ends the period filter can land on

  function capAt(d) { return d > asOf ? asOf : d; }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const months = [];
  for (let i = 23; i >= 0; i--) {
    const end = capAt(monthEnd(asOf.getUTCFullYear(), asOf.getUTCMonth() - i));
    months.push({
      key: end.getUTCFullYear() + "-" + String(end.getUTCMonth() + 1).padStart(2, "0"),
      label: monthNames[end.getUTCMonth()] + " " + end.getUTCFullYear(),
      iso: end.toISOString()
    });
  }

  // ---- distinct values, for the filter pickers and for a stable column order

  function distinct(key) {
    const seen = [];
    for (const p of people) {
      if (p[key] && seen.indexOf(p[key]) < 0) seen.push(p[key]);
    }
    return seen.sort((a, b) => {
      // "Not recorded" and "Other" always last, so they never head a list
      const rank = v => (v === NOT_RECORDED ? 2 : v === "Other" ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  }

  // ---- how much of this is actually populated, so the page can be honest about it

  const activeNow = people.filter(p => {
    const start = parseDate(p.s);
    if (start && start > asOf) return false;
    if (p.a === 1) return true;
    const term = parseDate(p.t);
    return !term || term > asOf;
  });

  function coverage(predicate) {
    if (!activeNow.length) return "0.0";
    return ((activeNow.filter(predicate).length / activeNow.length) * 100).toFixed(1);
  }

  // Records missing the recorded fields, so the gap is visible in the run log
  const missingGrade = activeNow.filter(p => p.gr === NOT_RECORDED).length;
  const missingDiscipline = activeNow.filter(p => p.d === NOT_RECORDED).length;

  return {
    generatedUtc: new Date().toISOString(),
    asOf: asOf.toISOString(),
    asOfLabel: monthNames[asOf.getUTCMonth()] + " " + asOf.getUTCFullYear(),
    months: months,
    filterOptions: {
      costCentres: distinct("c"),
      genders: distinct("g"),
      locations: distinct("l"),
      grades: distinct("gr"),
      disciplines: distinct("d")
    },
    coverage: {
      headcount: activeNow.length,
      birthDate: coverage(p => !!p.b),
      jobTitle: coverage(p => p.gr !== NOT_RECORDED),
      grade: coverage(p => p.gr !== NOT_RECORDED && p.gr !== "Other"),
      discipline: coverage(p => p.d !== NOT_RECORDED),
      gender: coverage(p => p.g !== NOT_RECORDED),
      startDate: coverage(p => !!p.s)
    },
    missingGrade: missingGrade,
    missingDiscipline: missingDiscipline,
    people: people,
    dataQuality: quality,
    minRowSize: MIN_ROW_SIZE
  };
}
