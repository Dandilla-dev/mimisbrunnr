// Поддельная модель для ручной и автоматической проверки интерфейса
// (OpenAI-совместимый формат). Запуск: node tests/fake-llm.mjs [порт]
import http from 'node:http';
const port = Number(process.argv[2] || 8799);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const user = JSON.parse(body).messages.at(-1).content;
    let answer;
    if (user.includes('Разложи файлы по смысловым слоям')) {
      const files = [...user.matchAll(/^- (\S+) \(/gm)].map((m) => m[1]);
      const ui = files.filter((f) => /components|features|App|main/.test(f));
      const rest = files.filter((f) => !ui.includes(f));
      answer = { summary: 'Обзор проекта от поддельной модели: здесь был бы рассказ о том, из каких частей состоит код и как они связаны.', layers: [{ name: 'Экраны и компоненты', description: 'То, что видит пользователь: экраны и их части.', files: ui }, { name: 'Состояние и настройка', description: 'Хранилище Redux, срезы и конфигурация сборки.', files: rest }] };
    } else if (user.includes('одним словом')) answer = null;
    else if (user.includes('по шагам — так, чтобы ученик понял')) {
      const ls = [...user.matchAll(/^\s*(\d+)\| /gm)].map((m) => Number(m[1]));
      const mid = ls[Math.floor(ls.length / 2)] || ls[0];
      answer = { steps: [{ from: ls[0], to: mid, title: 'Начало', text: 'Здесь было бы объяснение первых строк (поддельная модель).' }, { from: mid + 1, to: ls[ls.length - 1], title: 'Конец', text: 'Здесь было бы объяснение остальных строк (поддельная модель).' }] };
    } else if (user.includes('Разбираем сценарий')) {
      const ns = [...user.matchAll(/^\s*(\d+)\. /gm)].map((m) => Number(m[1]));
      answer = { title: 'Сценарий (поддельная модель)', summary: 'Здесь был бы связный рассказ о том, как проходит этот путь: откуда приходит запрос, что проверяется и где сохраняется. Это ответ поддельной модели.', steps: ns.map((n) => ({ n, text: `Шаг ${n}: здесь было бы объяснение, что происходит и зачем (поддельная модель).` })) };
    }
    else {
      const names = [...user.matchAll(/^- (.+?) \((?:функция|метод|класс|React-компонент|React-хук|маршрут|сущность),/gm)].map((m) => m[1]);
      answer = {
        file_purpose: 'Этот файл отвечает за часть интерфейса (ответ поддельной модели для проверки).',
        items: names.map((n) => ({ name: n, phrase: `${n} — короткое назначение.`, what: `Здесь было бы объяснение того, что делает ${n}: сначала идея, потом детали. Это ответ поддельной модели.`, io: 'Вход: пропсы или аргументы. Выход: JSX или значение.', example: `${n}({ x: 1 }) → результат`, watch: 'Подводный камень: пример текста от поддельной модели.' })),
        terms: [{ term: 'хук', definition: 'Функция React, которая даёт компоненту состояние или доступ к хранилищу (useState, useSelector).' }],
      };
    }
    const text = answer ? JSON.stringify(answer) : 'Готов';
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: Math.round(user.length / 3), completion_tokens: Math.round(text.length / 3) } }));
    }, 150);
  });
}).listen(port, '127.0.0.1', () => console.log(`fake llm on ${port}`));
