# Système de notifications (webhook + email + MQTT)

Date : 2026-05-23
Statut : ✅ implémenté — à tester end-to-end

---

## Objectif

Combler le plus gros manque produit identifié dans le topo : aucune sortie d'alerte. Désormais quand un Event Trigger se déclenche, un node downstream peut notifier via :

- **Webhook** : POST JSON arbitraire (Slack, Discord, Home Assistant, ntfy.sh, IFTTT, n8n, etc.)
- **Email** : SMTP standard (STARTTLS ou SMTPS)
- **MQTT** : publish sur un broker configuré

---

## Architecture

### Single node, 3 channels

Plutôt qu'un node par canal, un seul node `notify` avec un sélecteur `channel`. Avantages : palette qui reste lisible, ajout futur de canaux (Discord native, Telegram, Pushover, ntfy.sh) trivial.

### Inspector qui switch

Le `NotifyInspector` affiche les 3 onglets (boutons) en haut. La sélection déclenche le rendu des champs spécifiques :

| Canal | Champs |
|---|---|
| webhook | URL, method (POST/PUT), custom headers (JSON optionnel) |
| email | SMTP host/port/user/password, STARTTLS vs SSL, from, to (CSV), subject template, body template |
| mqtt | Broker (dropdown + bouton **+ New** inline), topic template, payload template, QoS, retain |

### Templating

Variables `{key}` substituables dans les subject/body/topic/payload :
`{class_name}`, `{class_id}`, `{confidence}`, `{tracker_id}`, `{zone_name}`, `{workflow_id}`, `{source_id}`, `{bbox_x1}`, `{bbox_y1}`, `{bbox_x2}`, `{bbox_y2}`.

Géré dans `notification_service.render_template()` via regex.

### Templating - cas email

Le body est optionnel : si vide, un dump auto-généré "Workflow #N fired K event(s)" + liste à puces. Si rempli, c'est le template avec substitution.

### Architecture MQTT — pool de connexions

`mqtt_service.py` maintient un `dict[broker_id, paho.Client]` en module-level avec un lock. À la première publication sur un broker, une connexion est créée et son `loop_start()` lancé (thread network paho). Réutilisée pour tous les publish suivants. En cas d'erreur, le client est éjecté du cache → la prochaine publication reconnecte.

Compatible `paho-mqtt` 2.x (CallbackAPIVersion.VERSION2) avec fallback 1.x.

À l'arrêt de FastAPI, `mqtt_service.shutdown_all()` ferme proprement toutes les connexions.

### Broker model (DB)

```python
class MqttBroker(Base):
    __tablename__ = "mqtt_brokers"
    id, name, host, port (1883),
    username, password, use_tls, client_id,
    keepalive (60), created_at
```

Le `password` n'est jamais exposé dans `MqttBrokerRead` (sécurité minimale).

### Création de broker inline depuis le node

Demandé explicitement par l'utilisateur. Implémenté via `BrokerModal` :

- Le `NotifyInspector` (channel=mqtt) affiche un dropdown des brokers + bouton **+ New**
- Click sur **+ New** → modal plein écran avec tous les champs broker
- Trois boutons :
  - **Save** : crée et l'auto-sélectionne dans le node
  - **Save & test** : crée + appelle `POST /api/mqtt/brokers/{id}/test` + affiche le résultat (vert si connecté, rouge avec message d'erreur sinon)
  - **Cancel** : ferme sans rien faire
- Aucun besoin de naviguer dans une page séparée — flux 100% inline depuis le node

### Implémentation du test

`mqtt_service.test_connection()` : connexion synchrone, `loop_start()`, courte attente (1.5s) pour laisser arriver le CONNACK, `is_connected()`, puis disconnect propre. Renvoie `(ok: bool, message: str)`.

---

## Comportement runtime

Le `NotifyNode` :

1. Vérifie que `context.events` est non vide (donc throttlé par le cooldown de l'EventTrigger upstream)
2. Selon le `channel`, exécute la méthode privée correspondante
3. Pour webhook : 1 POST par burst, body = `{workflow_id, source_id, count, events: [...]}`
4. Pour email : 1 email par burst, body listant tous les events
5. Pour MQTT : 1 publish par event (pas par burst) — chaque event a sa propre clé dans le topic via le template
6. Toutes les erreurs sont catchées et loguées (pas de crash workflow)

---

## Fichiers créés / modifiés

**Backend**
- `requirements.txt` : ajout `paho-mqtt>=2.1,<3`
- `app/db/models.py` : table `MqttBroker`
- `app/schemas/mqtt.py` : Pydantic create/update/read/test
- `app/services/mqtt_service.py` : pool de connexions + publish + test
- `app/services/notification_service.py` : webhook (urllib) + email (smtplib) + templating
- `app/engine/nodes/notify_node.py` : NotifyNode avec 3 canaux
- `app/engine/node_registry.py` : registre étendu
- `app/api/routes_mqtt.py` : CRUD brokers + endpoint /test
- `app/main.py` : router + shutdown_all dans le lifespan

**Frontend**
- `frontend/src/types/index.ts` : `MqttBroker`, `MqttBrokerPayload`
- `frontend/src/api/mqtt.ts` : client CRUD + test
- `frontend/src/pages/WorkflowBuilderPage.tsx` :
  - Import `mqttApi`, type `MqttBroker`
  - State `brokers` + `loadBrokers()` + fetch au mount
  - Plumbing jusqu'au NodeInspector (`brokers`, `reloadBrokers`)
  - Définition node `notify` (palette + icon + summary dynamique selon channel)
  - Composant `NotifyInspector` (channel switch + 3 sets de champs)
  - Composant `BrokerModal` (modal de création broker avec test inline)
  - Helpers `TextField`, `TextAreaField` (factorisation des inputs)

---

## Pour le déploiement

L'utilisateur doit installer la nouvelle dépendance :

```
pip install paho-mqtt>=2.1,<3
# OU
pip install -r backend/requirements.txt
```

Sans paho-mqtt, le node MQTT lèvera une `RuntimeError` propre au premier appel (catch par le node, log warning). Les autres canaux (webhook, email) continuent de marcher sans cette dep car ils utilisent uniquement la stdlib.

---

## Routes ajoutées

```
GET    /api/mqtt/brokers              → list
POST   /api/mqtt/brokers              → create
GET    /api/mqtt/brokers/{id}         → detail
PATCH  /api/mqtt/brokers/{id}         → update
DELETE /api/mqtt/brokers/{id}         → delete
POST   /api/mqtt/brokers/{id}/test    → test connection
```

---

## Validations

- TypeScript : aucune erreur
- Python : compile clean
- Routes vérifiées présentes au boot : `/api/mqtt/brokers` (+ sous-routes)
- `notify` présent dans `NODE_REGISTRY`
- 2026-05-23 : cache MQTT broker durci
  - `mqtt_service.invalidate_broker(broker_id)` ferme et retire un client cache ;
  - les routes `PATCH /api/mqtt/brokers/{id}` et `DELETE /api/mqtt/brokers/{id}` invalident le cache ;
  - tests automatisés ajoutés dans `backend/tests/test_mqtt.py`.
- Validation backend 2026-05-23 :
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests\test_engine.py tests\test_mqtt.py -q` : 30 tests passés ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests -q` : 69 tests passés après revue plans/API.

---

## À tester (à la fin du dev)

### Webhook
- [ ] Créer un workflow `Source → YOLO → Event Trigger → Notify (webhook)` pointant sur https://webhook.site
- [ ] Lancer → vérifier que webhook.site reçoit un POST JSON avec `{workflow_id, source_id, count, events}` quand un event fire
- [ ] Test avec Slack incoming-webhook : le message arrive dans le channel

### Email
- [ ] Configurer un compte Gmail avec mot de passe d'application
- [ ] Workflow `... → Notify (email)` avec subject template `Alert: {class_name}`
- [ ] Vérifier que l'email arrive avec le bon sujet et le body auto-généré
- [ ] Vérifier que STARTTLS (587) et SMTPS (465) fonctionnent tous les deux

### MQTT
- [ ] Spin up un Mosquitto local (`docker run -p 1883:1883 eclipse-mosquitto`)
- [ ] Workflow `... → Notify (mqtt)` → cliquer **+ New** → créer un broker `localhost:1883` → **Save & test** → vérifier "✓ Connected successfully"
- [ ] Subscriber `mosquitto_sub -h localhost -t '#' -v` → vérifier que les messages arrivent sur `omv/workflow/<id>/events`
- [ ] Tester avec template payload custom : `{"class": "{class_name}", "conf": {confidence}}` → vérifier la substitution
- [ ] Tester avec un broker authentifié (user/pass) + TLS

### Robustesse
- [ ] Stopper le broker pendant que le workflow tourne → vérifier que les warnings apparaissent dans les logs mais le workflow ne crash pas
- [ ] Redémarrer le broker → vérifier que les publications reprennent (reconnect transparent)
