// Встроенный справочник для начинающих: короткие проверенные заметки о том, что значат
// частые конструкции языков и фреймворков. Работает без ИИ и без интернета.
// Нужен в двух местах: у функции в окне («что здесь из Express и JavaScript») и в запросе
// к модели — чтобы она объясняла эти вещи одинаково и правильно, а не по памяти.
//
// Запись: { id, fw, title, re — признак в коде функции, file — признак в файле (импорт),
//           lang — 'js' | 'py', text — 2–5 предложений простыми словами }.

const E = [
  // ---------------------------------------------------------------- JavaScript
  { id: 'js-async', fw: 'JavaScript', lang: 'js', title: 'async / await', re: /\basync\b[\s\S]*\bawait\b|\bawait\s/,
    text: 'async перед функцией значит: она работает с ожиданием и всегда возвращает промис. await внутри неё ставит выполнение на паузу, пока не придёт результат (ответ базы, сети, файла), — а программа тем временем может обслуживать другие запросы. Если ожидаемое закончилось ошибкой, await её «выбрасывает», и её ловят через try / catch.' },
  { id: 'js-promise', fw: 'JavaScript', lang: 'js', title: 'Promise, .then / .catch', re: /\bnew Promise\b|\.then\s*\(|Promise\.(all|race|allSettled)\b/,
    text: 'Промис — «обещание» результата, который появится позже. .then(f) говорит: когда результат придёт, вызови f; .catch(f) — если случится ошибка. Promise.all([...]) ждёт сразу несколько промисов и отдаёт все результаты вместе. await — более короткая запись того же самого.' },
  { id: 'js-try', fw: 'JavaScript', lang: 'js', title: 'try / catch / finally', re: /\btry\s*\{/,
    text: 'В try кладут код, который может сломаться. Если внутри случилась ошибка, выполнение сразу прыгает в catch (err) — там решают, что делать: ответить клиенту, записать в лог, передать дальше. finally выполняется в любом случае — и при успехе, и при ошибке.' },
  { id: 'js-throw', fw: 'JavaScript', lang: 'js', title: 'throw new Error', re: /\bthrow\s+(new\s+)?\w*/,
    text: 'throw «бросает» ошибку: функция сразу прекращает работу, а ошибка летит вверх к тому, кто её вызвал, пока её не поймает какой-нибудь catch. Если не поймает никто — в веб-приложении сработает обработчик ошибок, а в обычной программе она упадёт.' },
  { id: 'js-destr', fw: 'JavaScript', lang: 'js', title: 'Деструктуризация { a, b } = obj', re: /(?:const|let|var)\s*\{[^}]+\}\s*=|(?:const|let|var)\s*\[[^\]]+\]\s*=|\(\s*\{[^}]*\}\s*\)\s*=>/,
    text: 'const { name, age } = user — короткая запись для const name = user.name; const age = user.age. Так же со списками: const [first, second] = list. В параметрах функции ({ id }) => … значит: из пришедшего объекта сразу взять поле id.' },
  { id: 'js-spread', fw: 'JavaScript', lang: 'js', title: 'Три точки ...', re: /\.\.\.\w/,
    text: 'Три точки «раскрывают» объект или массив: { ...user, age: 30 } — копия user, в которой age заменён; [...list, x] — новый массив с x в конце. Исходный объект при этом не меняется. В параметрах (...args) значит обратное: собрать все аргументы в массив.' },
  { id: 'js-optional', fw: 'JavaScript', lang: 'js', title: '?. и ??', re: /\?\.\w|\?\?/,
    text: 'a?.b — «возьми b, если a существует; если a равно null или undefined — дай undefined, а не ошибку». a ?? b — «a, а если a пустое (null или undefined) — то b». Это защита от ошибок вида «Cannot read properties of undefined».' },
  { id: 'js-arrow', fw: 'JavaScript', lang: 'js', title: 'Стрелочная функция =>', re: /=>/,
    text: '(x) => x * 2 — короткая запись функции. Если после стрелки нет фигурных скобок, результат возвращается сам, без return. Стрелочные функции часто передают другим функциям: в map, в обработчики событий, в маршруты.' },
  { id: 'js-array', fw: 'JavaScript', lang: 'js', title: 'map / filter / reduce / find', re: /\.(map|filter|reduce|find|some|every)\s*\(/,
    text: 'Методы массива: map — сделать новый массив, преобразовав каждый элемент; filter — оставить только подходящие; find — найти первый подходящий; reduce — свернуть весь массив в одно значение (например, сумму); some / every — «есть ли хоть один» / «все ли». Исходный массив они не меняют.' },
  { id: 'js-module', fw: 'JavaScript', lang: 'js', title: 'import / export, require', re: /^\s*import\s|\brequire\s*\(/m,
    text: 'Код разложен по файлам-модулям. export делает функцию или переменную доступной другим файлам, import — берёт её оттуда. require(...) и module.exports — то же самое в старом стиле Node.js (CommonJS).' },
  { id: 'js-env', fw: 'Node.js', lang: 'js', title: 'process.env', re: /\bprocess\.env\b/,
    text: 'process.env — настройки, которые передают программе при запуске (переменные окружения): порт, адрес базы, секретные ключи. Их не пишут в код, чтобы не выкладывать пароли в репозиторий; обычно они лежат в файле .env, которого в репозитории нет.' },
  // ---------------------------------------------------------------- Express
  { id: 'ex-handler', fw: 'Express', lang: 'js', title: 'Обработчик (req, res, next)', re: /\(\s*req\s*,\s*res\b/,
    text: 'Так выглядит функция, которую Express вызывает на каждый подходящий запрос. req — входящий запрос: адрес, параметры, тело. res — ответ, который мы отправим клиенту. next — «передай запрос дальше»: следующему промежуточному обработчику или, с ошибкой next(err), — обработчику ошибок.' },
  { id: 'ex-req', fw: 'Express', lang: 'js', title: 'req.params, req.query, req.body', re: /\breq\.(params|query|body|headers|user)\b/, file: /express|req/,
    text: 'Откуда берутся данные запроса: req.params — части адреса (/books/:isbn → req.params.isbn); req.query — то, что после ? в адресе (?page=2); req.body — тело запроса (данные формы или JSON; чтобы оно появилось, нужен app.use(express.json())); req.headers — заголовки, например токен.' },
  { id: 'ex-res', fw: 'Express', lang: 'js', title: 'res.json / res.status / res.send', re: /\bres\.(json|status|send|sendStatus|redirect|end|render)\s*\(/, file: /express|res/,
    text: 'Так отвечают клиенту. res.json(obj) — отправить данные в формате JSON; res.status(404) — задать код ответа (200 — всё хорошо, 201 — создано, 400 — ошибка в запросе, 401 — не авторизован, 404 — не найдено, 500 — ошибка сервера); res.sendStatus(201) — только код без данных. Ответить можно один раз: второй ответ вызовет ошибку.' },
  { id: 'ex-next', fw: 'Express', lang: 'js', title: 'next() и next(err)', re: /\bnext\s*\(/, file: /express|next/,
    text: 'next() — «я закончил, передай запрос следующему обработчику». next(err) — «случилась ошибка»: Express пропустит все обычные обработчики и сразу вызовет обработчик ошибок — функцию с четырьмя параметрами (err, req, res, next).' },
  { id: 'ex-use', fw: 'Express', lang: 'js', title: 'app.use(...)', re: /\b(app|router)\.use\s*\(/,
    text: 'app.use подключает промежуточный обработчик (middleware) — функцию, через которую пройдёт каждый запрос, по порядку подключения. Так подключают разбор JSON (express.json()), проверку токена, логирование, роутеры с маршрутами и обработчик ошибок — его подключают последним.' },
  { id: 'ex-router', fw: 'Express', lang: 'js', title: 'Router и маршруты', re: /\b(express\.)?Router\s*\(|\b(app|router)\.(get|post|put|patch|delete)\s*\(/,
    text: 'router.get("/books/:id", handler) — маршрут: «на запрос GET по такому адресу вызови handler». Router — отдельный набор маршрутов, который потом подключают к приложению через app.use. Между адресом и обработчиком можно перечислить промежуточные обработчики: router.post("/", auth, validate, create).' },
  { id: 'ex-json', fw: 'Express', lang: 'js', title: 'express.json()', re: /express\.json\s*\(/,
    text: 'express.json() — промежуточный обработчик, который читает тело запроса и превращает JSON в объект req.body. Без него req.body будет пустым.' },
  // ---------------------------------------------------------------- Sequelize
  { id: 'sq-find', fw: 'Sequelize', lang: 'js', title: 'findByPk / findOne / findAll', re: /\.(findByPk|findOne|findAll|findOrCreate|findAndCountAll)\s*\(/, file: /sequelize|\.model|models?\//i,
    text: 'Чтение из базы через модель: findByPk(id) — найти запись по первичному ключу; findOne({ where: {...} }) — первую подходящую; findAll({ where, include }) — все подходящие. Если ничего не нашлось, findByPk и findOne возвращают null — это нужно проверять. include подтягивает связанные записи (например, авторов книги).' },
  { id: 'sq-write', fw: 'Sequelize', lang: 'js', title: 'create / update / destroy', re: /\.(create|bulkCreate|update|destroy|save)\s*\(/, file: /sequelize|\.model|models?\//i,
    text: 'Запись в базу: Model.create({...}) — добавить строку; record.update({...}) или изменить поля и record.save() — обновить; record.destroy() — удалить. Все они возвращают промис, поэтому перед ними пишут await.' },
  { id: 'sq-assoc', fw: 'Sequelize', lang: 'js', title: 'Связи: belongsTo, hasMany, belongsToMany', re: /\.(belongsTo|hasMany|hasOne|belongsToMany)\s*\(|\.(set|add|get|remove)[A-Z]\w*s?\s*\(/, file: /sequelize|\.model|models?\//i,
    text: 'Связи между моделями: belongsTo — «принадлежит» (у книги один издатель), hasMany — «имеет много», belongsToMany — «многие ко многим» (у книги много авторов, у автора много книг; хранится в отдельной таблице-связке). Из связи Sequelize сам создаёт методы: book.setAuthors([...]), book.addAuthor(a), book.getAuthors().' },
  { id: 'sq-tx', fw: 'Sequelize', lang: 'js', title: 'Транзакция', re: /\btransaction\s*\(|\b(commit|rollback)\s*\(/, file: /sequelize/i,
    text: 'Транзакция — «всё или ничего»: несколько изменений в базе либо сохраняются вместе (commit), либо, если что-то пошло не так, отменяются все сразу (rollback). Так база не остаётся в полусохранённом состоянии: например, книга добавилась, а её авторы — нет.' },
  { id: 'sq-define', fw: 'Sequelize', lang: 'js', title: 'Модель Sequelize (описание таблицы)', re: /\.define\s*\(|extends\s+Model\b|\bDataTypes\.\w+/, file: /sequelize/i,
    text: 'Модель описывает таблицу в базе: имя, столбцы и их типы (DataTypes.STRING — строка, INTEGER — целое, DATE — дата), правила (allowNull: false — обязательное поле, primaryKey — ключ, unique — без повторов). По модели Sequelize сам составляет SQL-запросы, а sync() может создать таблицу.' },
  // ---------------------------------------------------------------- Mongoose
  { id: 'mg-schema', fw: 'Mongoose', lang: 'js', title: 'Schema и model', re: /new\s+(mongoose\.)?Schema\s*\(|mongoose\.model\s*\(/,
    text: 'Schema описывает, как выглядит документ в MongoDB: поля, типы, обязательность (required), значения по умолчанию. mongoose.model("Book", schema) делает из схемы модель — объект, через который ищут, создают и меняют документы этой коллекции.' },
  { id: 'mg-query', fw: 'Mongoose', lang: 'js', title: 'find / findById / save', re: /\.(find|findById|findOne|findByIdAndUpdate|findByIdAndDelete|save|populate)\s*\(/, file: /mongoose/,
    text: 'Работа с MongoDB через модель: find({...}) — найти документы по условию; findById(id) — по идентификатору; doc.save() — сохранить; populate("author") — вместо идентификатора подставить сам связанный документ. Всё асинхронное — с await.' },
  // ---------------------------------------------------------------- Prisma
  { id: 'pr-client', fw: 'Prisma', lang: 'js', title: 'prisma.модель.метод()', re: /\bprisma\.\w+\.(findUnique|findFirst|findMany|create|update|upsert|delete)\w*\s*\(/,
    text: 'Prisma — инструмент для работы с базой: prisma.user.findMany({ where }) — найти пользователей; findUnique — одного по уникальному полю; create / update / delete — изменить. Названия моделей и поля берутся из файла schema.prisma, поэтому редактор подсказывает ошибки ещё до запуска.' },
  // ---------------------------------------------------------------- NestJS
  { id: 'ne-deco', fw: 'NestJS', lang: 'js', title: 'Декораторы @Controller, @Get, @Body', re: /@(Controller|Get|Post|Put|Patch|Delete|Body|Param|Query)\s*\(/,
    text: 'В NestJS маршруты задают декораторами — пометками над классом и методами. @Controller("books") — общий адрес, @Get(":id") — маршрут, @Param("id") / @Body() / @Query() — откуда взять данные для параметра метода. Сам Nest находит эти пометки и вызывает нужный метод на каждый запрос.' },
  { id: 'ne-di', fw: 'NestJS', lang: 'js', title: 'Внедрение зависимостей (constructor)', re: /constructor\s*\(\s*(private|public|protected|readonly)/, file: /@nestjs/,
    text: 'constructor(private booksService: BooksService) — класс говорит «мне нужен BooksService», а Nest сам создаёт его и передаёт. Это называется внедрением зависимостей: класс не создаёт помощников сам, поэтому их легко подменить, например в тестах.' },
  { id: 'ne-guard', fw: 'NestJS', lang: 'js', title: 'Guard, Pipe, Interceptor', re: /@Use(Guards|Pipes|Interceptors)\s*\(|implements\s+(CanActivate|PipeTransform|NestInterceptor)/,
    text: 'Шаги, через которые запрос проходит до метода контроллера. Guard решает, пускать ли запрос (например, проверка токена). Pipe проверяет и преобразует данные (ValidationPipe проверяет DTO). Interceptor оборачивает вызов — может что-то сделать до и после (логирование, изменение ответа).' },
  { id: 'ne-exc', fw: 'NestJS', lang: 'js', title: 'NotFoundException и другие', re: /\b(NotFound|BadRequest|Unauthorized|Forbidden|Conflict)Exception\b/,
    text: 'Исключения NestJS сразу превращаются в ответ клиенту с нужным кодом: NotFoundException — 404, BadRequestException — 400, UnauthorizedException — 401, ForbiddenException — 403. Достаточно написать throw new NotFoundException(...), остальное Nest сделает сам.' },
  // ---------------------------------------------------------------- TypeORM
  { id: 'to-repo', fw: 'TypeORM', lang: 'js', title: 'Репозиторий TypeORM', re: /\.(findOneBy|findOne|find|save|remove|delete)\s*\(/, file: /typeorm/i,
    text: 'Репозиторий — объект для работы с одной таблицей: find / findOneBy — прочитать, save — добавить или обновить, remove / delete — удалить. Таблицу описывает класс-сущность с декоратором @Entity, а столбцы — @Column.' },
  // ---------------------------------------------------------------- React
  { id: 're-state', fw: 'React', lang: 'js', title: 'useState', re: /\buseState\s*\(/,
    text: 'const [value, setValue] = useState(начальное) — память компонента. value — текущее значение, setValue — способ его изменить. После setValue React перерисует компонент с новым значением. Менять value напрямую нельзя — только через setValue.' },
  { id: 're-effect', fw: 'React', lang: 'js', title: 'useEffect', re: /\buseEffect\s*\(/,
    text: 'useEffect(() => {...}, [deps]) — код, который выполняется после отрисовки: загрузить данные, подписаться на событие, поставить таймер. Массив в конце — «когда повторять»: [] — один раз, [id] — каждый раз, когда изменился id. Если вернуть функцию, React вызовет её при уходе компонента — там отписываются.' },
  { id: 're-props', fw: 'React', lang: 'js', title: 'Компонент и props', re: /return\s*\(?\s*<|=>\s*\(?\s*</,
    text: 'Компонент — функция, которая возвращает разметку (JSX — HTML-подобный код внутри JavaScript). Данные приходят в неё через props — как аргументы: <CartItem item={x} onRemove={f} />. Фигурные скобки {...} внутри JSX — место, куда подставляется значение из JavaScript.' },
  { id: 're-redux', fw: 'Redux', lang: 'js', title: 'useSelector / useDispatch', re: /\buse(Selector|Dispatch|AppSelector|AppDispatch)\s*\(/,
    text: 'Redux — общее хранилище данных приложения. useSelector(state => state.cart) достаёт нужный кусок, и компонент перерисуется, когда он изменится. useDispatch даёт функцию dispatch, через которую отправляют «действие» (action) — описание того, что произошло; хранилище обновится по правилам из slice.' },
  { id: 're-slice', fw: 'Redux', lang: 'js', title: 'createSlice', re: /\bcreateSlice\s*\(/,
    text: 'createSlice описывает часть хранилища: начальное состояние и reducers — функции «как изменить состояние при таком-то действии». Внутри них можно писать state.items.push(x) — Redux Toolkit сам сделает из этого безопасную копию. Действия (actions) создаются автоматически из имён reducers.' },
  { id: 're-query', fw: 'Redux', lang: 'js', title: 'RTK Query', re: /\bcreateApi\s*\(|\buse\w+(Query|Mutation)\s*\(/,
    text: 'RTK Query сам загружает данные с сервера и хранит их. createApi описывает запросы (endpoints), а из них появляются хуки: useGetBooksQuery() — загрузить и следить (вернёт data, isLoading, error), useAddBookMutation() — отправить изменение. Повторные запросы за теми же данными берутся из кеша.' },
  // ---------------------------------------------------------------- Python
  { id: 'py-deco', fw: 'Python', lang: 'py', title: 'Декоратор @', re: /^\s*@\w/m,
    text: 'Строка с @ над функцией — декоратор: он «оборачивает» функцию, добавляя к ней поведение. @app.get("/books") регистрирует функцию как обработчик адреса; @login_required сначала проверяет вход; @dataclass сам пишет конструктор класса. Сама функция под ним при этом не вызывается.' },
  { id: 'py-async', fw: 'Python', lang: 'py', title: 'async def / await', re: /\basync\s+def\b|\bawait\s/,
    text: 'async def — функция, которая умеет ждать, не блокируя программу. await ставит её на паузу, пока не придёт результат (база, сеть), а сервер тем временем обслуживает другие запросы. Вызвать такую функцию можно только с await из другой async-функции.' },
  { id: 'py-with', fw: 'Python', lang: 'py', title: 'with ... as ...', re: /^\s*(async\s+)?with\s/m,
    text: 'with открывает ресурс и гарантированно закрывает его в конце блока — даже если внутри случилась ошибка. Так работают с файлами, соединениями и транзакциями базы: with db.transaction(): ... — всё внутри сохранится вместе или откатится вместе.' },
  { id: 'py-comp', fw: 'Python', lang: 'py', title: 'Генератор списка [x for x in ...]', re: /\[[^\]]+\bfor\b[^\]]+\bin\b[^\]]+\]|\{[^}]+\bfor\b[^}]+\bin\b[^}]+\}/,
    text: '[f(x) for x in items if условие] — короткая запись цикла, который собирает новый список: пройти по items, оставить подходящие, к каждому применить f. С фигурными скобками получается словарь или множество.' },
  { id: 'py-raise', fw: 'Python', lang: 'py', title: 'raise и try / except', re: /\braise\b|\btry\s*:/,
    text: 'raise выбрасывает ошибку (исключение): функция сразу прекращает работу, ошибка летит к тому, кто её вызвал. try: ... except ОшибкаТакая: ... ловит её и решает, что делать. finally выполняется в любом случае.' },
  { id: 'py-optional', fw: 'Python', lang: 'py', title: 'Аннотации типов: Optional, list[str], -> ', re: /:\s*(Optional|List|Dict|list|dict|str|int|float|bool)\b|->\s*\w/,
    text: 'name: str, -> int — подсказки, какого типа значение ожидается. Python сам их не проверяет при запуске, но их читают редактор и некоторые библиотеки (FastAPI, Pydantic — они как раз проверяют данные по этим типам). Optional[X] или X | None — «X или ничего».' },
  { id: 'py-self', fw: 'Python', lang: 'py', title: 'self и __init__', re: /\bdef\s+__init__\s*\(|\bself\.\w/,
    text: 'Методы класса получают первым параметром self — сам объект, у которого их вызвали; self.name — поле этого объекта. __init__ — конструктор: выполняется при создании объекта (User("Аня")) и заполняет его поля.' },
  { id: 'py-dataclass', fw: 'Python', lang: 'py', title: '@dataclass', re: /@dataclass\b/,
    text: '@dataclass над классом говорит Python: «это просто набор полей, напиши конструктор и сравнение сам». Поля перечисляют с типами: name: str, price: float = 0. Удобно для простых объектов с данными.' },
  // ---------------------------------------------------------------- FastAPI
  { id: 'fa-route', fw: 'FastAPI', lang: 'py', title: '@app.get / @router.post', re: /@\w+\.(get|post|put|patch|delete|websocket)\s*\(/, file: /fastapi/,
    text: 'Декоратор связывает функцию с адресом и методом: @router.post("/books") — «на POST /books вызови эту функцию». Параметры функции FastAPI заполняет сам: из адреса ({id}), из строки запроса (?page=), из тела (если тип — Pydantic-модель). Что функция вернёт, станет ответом в формате JSON.' },
  { id: 'fa-depends', fw: 'FastAPI', lang: 'py', title: 'Depends(...)', re: /\bDepends\s*\(/,
    text: 'Depends(get_db) — «перед вызовом обработчика вызови get_db и передай результат в этот параметр». Так подключают общие вещи: соединение с базой, текущего пользователя по токену, проверку прав. Если зависимость выбросит ошибку (например, 401), обработчик не вызовется вовсе.' },
  { id: 'fa-http', fw: 'FastAPI', lang: 'py', title: 'HTTPException', re: /\bHTTPException\s*\(/,
    text: 'raise HTTPException(status_code=404, detail="...") — прервать обработку и ответить клиенту ошибкой с этим кодом и текстом. 400 — ошибка в запросе, 401 — не авторизован, 403 — нет прав, 404 — не найдено, 409 — конфликт (например, уже существует).' },
  { id: 'fa-pyd', fw: 'Pydantic', lang: 'py', title: 'BaseModel (схема данных)', re: /\(\s*BaseModel\s*\)|\bField\s*\(|response_model\s*=/,
    text: 'Класс-наследник BaseModel описывает, какие данные ожидаются: поля и их типы, правила (Field(min_length=1)). FastAPI проверяет по нему тело запроса и сам отвечает 422 с описанием ошибок, если данные не подходят. response_model — такая же схема для ответа: лишние поля в ответ не попадут.' },
  { id: 'fa-router', fw: 'FastAPI', lang: 'py', title: 'APIRouter и include_router', re: /\bAPIRouter\s*\(|\binclude_router\s*\(/,
    text: 'APIRouter — набор маршрутов в отдельном файле. app.include_router(router, prefix="/api") подключает его к приложению: все его адреса начнутся с /api. Так большой API раскладывают по файлам.' },
  // ---------------------------------------------------------------- Flask
  { id: 'fl-request', fw: 'Flask', lang: 'py', title: 'request, jsonify', re: /\brequest\.(json|args|form|get_json|headers)\b|\bjsonify\s*\(/, file: /flask/,
    text: 'В Flask данные запроса берут из объекта request: request.args — параметры после ? в адресе, request.json / get_json() — тело в формате JSON, request.form — данные формы. jsonify(obj) превращает данные в ответ JSON. Можно вернуть и пару (данные, код): return jsonify(err), 404.' },
  { id: 'fl-bp', fw: 'Flask', lang: 'py', title: 'Blueprint', re: /\bBlueprint\s*\(|register_blueprint\s*\(/,
    text: 'Blueprint — набор маршрутов, который потом регистрируют в приложении: app.register_blueprint(bp, url_prefix="/shop"). Так приложение делят на части по смыслу.' },
  { id: 'fl-hooks', fw: 'Flask', lang: 'py', title: 'before_request, errorhandler', re: /@\w+\.(before_request|after_request|errorhandler)\b/,
    text: '@app.before_request — функция, которая выполняется перед каждым запросом (например, проверка входа); если она что-то вернёт, это и станет ответом, а обработчик не вызовется. @app.errorhandler(404) — что ответить, если случилась такая ошибка.' },
  // ---------------------------------------------------------------- SQLAlchemy / SQLModel
  { id: 'sa-session', fw: 'SQLAlchemy', lang: 'py', title: 'Сессия: add, commit, query', re: /\b(session|db)\.(add|commit|rollback|query|execute|get|delete|refresh|flush)\s*\(|\bselect\s*\(\s*[A-Z]/,
    text: 'Сессия — «рабочий стол» для общения с базой. session.add(obj) — подготовить запись, session.commit() — сохранить все изменения разом, rollback() — отменить. Чтение: session.get(Model, id) — по ключу; session.execute(select(Model).where(...)) или старый стиль session.query(Model).filter(...) — по условию.' },
  { id: 'sa-model', fw: 'SQLAlchemy', lang: 'py', title: 'Модель: Column, relationship, ForeignKey', re: /\b(Column|mapped_column|relationship|ForeignKey)\s*\(/,
    text: 'Класс-модель описывает таблицу: __tablename__ — имя таблицы, Column / mapped_column — столбцы, ForeignKey("users.id") — ссылка на запись другой таблицы. relationship — удобный доступ к связанным объектам: order.user вместо поиска по user_id.' },
];

const HB = E.map((e) => ({ ...e }));
export const HANDBOOK = HB;

/** Текст без содержимого строк и комментариев — чтобы «res.json» в тексте ошибки не считался вызовом. */
function codeOnly(code, lang) {
  return code.split('\n').map((l) => {
    let x = l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    x = lang === 'py' ? x.replace(/#.*$/, '') : x.replace(/\/\/.*$/, '');
    return x;
  }).join('\n');
}

/**
 * Заметки, которые относятся к этому коду. code — код функции (или файла), fileCode — весь файл
 * (для признаков-импортов). Порядок — как первое появление в коде. limit — сколько максимум.
 */
export function handbookFor(code, { fileCode = code, lang = 'js', limit = 8 } = {}) {
  const l = lang === 'python' || lang === 'py' ? 'py' : 'js';
  const c = codeOnly(code || '', l);
  const out = [];
  for (const e of HB) {
    if (e.lang !== l) continue;
    if (e.file && !e.file.test(fileCode || '')) continue;
    const m = c.match(e.re);
    if (m) out.push({ e, at: m.index ?? 0 });
  }
  // JS-основы (стрелки, import) — в конец: они есть почти везде и важны меньше фреймворков
  const basic = new Set(['js-arrow', 'js-module', 'js-array', 'py-optional', 'py-self']);
  out.sort((a, b) => (basic.has(a.e.id) - basic.has(b.e.id)) || a.at - b.at);
  return out.slice(0, limit).map((x) => x.e);
}

/** Блок для запроса к модели. known — термины, которые уже есть в словаре проекта. */
export function handbookPrompt(entries) {
  if (!entries.length) return '';
  return `\nСправочник (проверенные факты о том, что встречается в этом коде; опирайся на них, не противоречь им, но не пересказывай целиком — используй там, где это помогает понять код):\n${entries.map((e) => `- ${e.fw} · ${e.title}: ${e.text}`).join('\n')}\n`;
}
