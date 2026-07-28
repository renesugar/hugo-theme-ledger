---
title: "Hugo taxonomy performance"
date: 2026-06-13
summary: "Why ranging over site.RegularPages inside a partial turns a build into an O(n²) problem."
categories: ["Writing"]
tags: ["hugo", "markdown", "performance"]
readingTime: 11
---

Why ranging over site.RegularPages inside a partial turns a build into an O(n²) problem.

## Why it matters

The point of this note is not the conclusion but the constraint that produced
it. Write the constraint down first; the conclusion tends to follow from it and
is easier to revise later when the constraint changes.

> Every note should be able to answer the question it was written to settle.

- The constraint that forced the decision
- The option that was rejected, and what it cost
- The thing that would make me change my mind

## In practice

Revisit this on the next pass. If the note has not been useful in six months it
is either wrong or it belongs somewhere else entirely.
