import type { ArchiveAuthor, EthnographyArchive, FieldworkLeg } from './types';

export function fieldworkForAuthor(archives: EthnographyArchive[], authorName: string): FieldworkLeg[] {
  const normalized = authorName.trim();
  return archives
    .flatMap(archive => archive.fieldwork.filter(leg => archive.contributors.some(author => author.id === leg.authorId && author.name === normalized)))
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
}

export interface NationalFieldworkLeg {
  author: ArchiveAuthor;
  leg: FieldworkLeg;
}

export function fieldworkForNationality(archives: EthnographyArchive[], countryCode: string, countryName?: string): NationalFieldworkLeg[] {
  return archives.flatMap(archive => archive.fieldwork.flatMap(leg => {
    const author = archive.contributors.find(contributor => contributor.id === leg.authorId);
    if (!author || !leg.start) return [];
    return author.nationality?.countryCode === countryCode || author.nationality?.name === countryName ? [{ author, leg }] : [];
  })).sort((a, b) => a.leg.start!.localeCompare(b.leg.start!));
}
