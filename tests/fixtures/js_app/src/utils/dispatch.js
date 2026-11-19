function onCreate(event) {
  return `created ${event.id}`;
}

function onDelete(event) {
  return `deleted ${event.id}`;
}

const handlers = { create: onCreate, delete: onDelete };

export function dispatch(event) {
  return handlers[event.type](event);
}

export class Mailer {
  sendWelcomeLetter(to) {
    return `welcome, ${to}`;
  }
}

export function notify(mailer, user) {
  return mailer.sendWelcomeLetter(user);
}
