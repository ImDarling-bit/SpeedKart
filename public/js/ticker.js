// Horloge de l'hôte, dans un Web Worker : les navigateurs ralentissent fortement les minuteurs
// d'un onglet en arrière-plan, mais beaucoup moins ceux d'un worker. La simulation des bots
// et des objets continue donc même si l'hôte change d'onglet.
let timer = null;
self.onmessage = (e) => {
  clearInterval(timer);
  if (e.data > 0) timer = setInterval(() => self.postMessage(0), e.data);
};
