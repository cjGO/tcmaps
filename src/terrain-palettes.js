export const elevationPalettes = {
  terrain: { label: 'Green · sand', colors: ['#4d7467', '#a8b28a', '#d9c79f'] },
  coast: { label: 'Blue · gold · red', colors: ['#326ba8', '#f2d879', '#b94b41'] },
  dusk: { label: 'Purple · teal · gold', colors: ['#71529b', '#55b6ad', '#f0d080'] },
};

export function elevationRamp(palette = 'terrain') {
  return `linear-gradient(to right,${elevationPalettes[palette].colors.join(',')})`;
}
