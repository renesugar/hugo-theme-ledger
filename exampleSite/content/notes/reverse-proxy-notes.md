---
title: "Reverse proxy notes"
date: 2026-05-02
summary: "Terminating TLS once, at the edge, and letting everything behind it speak plain HTTP."
categories: ["Homelab"]
tags: ["docker", "networking"]
readingTime: 8
---

Written down after the third time I had to work it out again from scratch.

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
