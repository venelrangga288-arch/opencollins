-- Baseline: the Agent / AgentStep tables were created with prisma db push
-- before migration tracking existed. Columns below were taken from pg_dump
-- of the production schema so this migration reproduces them exactly.

CREATE TYPE public."AgentRunBy" AS ENUM (
    'USER',
    'OPERATOR'
);


--
-- Name: AgentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: BillingStatus; Type: TYPE; Schema: public; Owner: -
--


CREATE TABLE public."Agent" (
    id text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    model text NOT NULL,
    status public."AgentStatus" DEFAULT 'QUEUED'::public."AgentStatus" NOT NULL,
    "runBy" public."AgentRunBy" DEFAULT 'USER'::public."AgentRunBy" NOT NULL,
    "totalTokens" integer DEFAULT 0 NOT NULL,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "finishedAt" timestamp(3) without time zone
);


--
-- Name: AgentStep; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentStep" (
    id text NOT NULL,
    "agentId" text NOT NULL,
    index integer NOT NULL,
    prompt text NOT NULL,
    status public."AgentStatus" DEFAULT 'QUEUED'::public."AgentStatus" NOT NULL,
    result text,
    tokens integer DEFAULT 0 NOT NULL,
    "latencyMs" integer,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE ONLY public."AgentStep"
    ADD CONSTRAINT "AgentStep_pkey" PRIMARY KEY (id);


--
-- Name: Agent Agent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_pkey" PRIMARY KEY (id);


CREATE INDEX "AgentStep_agentId_index_idx" ON public."AgentStep" USING btree ("agentId", index);


--
-- Name: Agent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_status_idx" ON public."Agent" USING btree (status);


--
-- Name: Agent_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_userId_createdAt_idx" ON public."Agent" USING btree ("userId", "createdAt");


ALTER TABLE ONLY public."AgentStep"
    ADD CONSTRAINT "AgentStep_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Agent Agent_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

